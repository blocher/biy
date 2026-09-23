import json
from datetime import timedelta
from types import SimpleNamespace as NS
from unittest.mock import patch
from uuid import uuid4

import httpx
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from openai import RateLimitError

from .chat import (
    AnswerPreview,
    catholic_sources,
    chat_model_for,
    context_for,
    local_fast_path,
    local_lookup_query,
    navigation_fast_path,
    process_chat,
    run_turn,
    safe_internal_path,
)
from .chat_api import turn_data
from .models import (
    CatechismDay,
    Day,
    DayProgress,
    Commentary,
    CommentaryAuthor,
    Episode,
    Era,
    Note,
    SearchChunk,
    StudyConversation,
    StudyTurn,
    StudyWorker,
    Verse,
)
from .search import (
    accessible_chunks,
    embed_batch,
    find_reading_days,
    index_chapter,
    index_note,
    reading_notes,
    search_site,
    sources_current,
)


@override_settings(OPENAI_API_KEY="", MAGISTERIUM_API_KEY="")
class StudyChatTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.user = users.objects.create_user("reader", password="long-test-password")
        self.other = users.objects.create_user("friend", password="long-test-password")
        era = Era.objects.create(name="Beginnings", color="#fff", order=1)
        self.day = Day.objects.create(number=1, era=era, readings=["Genesis 1"])
        self.day2 = Day.objects.create(number=2, era=era, readings=["Genesis 2"])
        self.client.force_login(self.user)

    def test_chat_model_routes_direct_questions_to_luna_and_summaries_to_terra(self):
        self.assertEqual(chat_model_for("What is fiat lux?"), "gpt-5.6-luna")
        self.assertEqual(
            chat_model_for(
                "In John 1:5, I highlighted:\n\n“"
                + "word " * 80
                + "”\n\nWhat should I notice here?"
            ),
            "gpt-5.6-luna",
        )
        self.assertEqual(
            chat_model_for("Summarize the readings and explain the main themes in detail."),
            "gpt-5.6-terra",
        )

    def test_answer_preview_waits_for_complete_paragraph_and_citations(self):
        preview = AnswerPreview()
        self.assertEqual(preview.feed('{"paragraphs":[{"text":"A \\"quote\\"'), [])
        self.assertEqual(preview.feed(', still writing","source_ids":["S1"'), [])
        self.assertEqual(
            preview.feed(']},{"text":"Second","source_ids":[]}],"links":[]'),
            [
                {"text": 'A "quote", still writing', "source_ids": ["S1"]},
                {"text": "Second", "source_ids": []},
            ],
        )
        self.assertEqual(preview.feed(',"follow_ups":[] }'), [])

    @patch("study.chat.client")
    def test_streaming_turn_publishes_only_cited_complete_paragraphs(self, factory):
        self.note()
        source = search_site(self.user, "Eucharist", semantic=False)["sources"][0]
        conversation = StudyConversation.objects.create(user=self.user, day=self.day)
        turn = StudyTurn.objects.create(
            conversation=conversation,
            request_id=uuid4(),
            question="What does this reflection say about the Eucharist?",
            web_enabled=False,
            status="running",
        )
        complete = {
            "paragraphs": [
                {"text": "The reflection mentions sacrifice.", "source_ids": [source["id"]]},
                {"text": "This needs another source.", "source_ids": ["S999999"]},
            ],
            "follow_ups": ["What else?", "How does it connect?"],
            "links": [],
        }

        def events():
            yield NS(type="response.output_text.delta", delta='{"paragraphs":[{"text":"The reflection')
            turn.refresh_from_db()
            self.assertEqual(turn.answer, "")
            yield NS(
                type="response.output_text.delta",
                delta=f' mentions sacrifice.","source_ids":["{source["id"]}"]}},',
            )
            turn.refresh_from_db()
            self.assertIn("The reflection mentions sacrifice.", turn.answer)
            visible = turn_data(turn, self.user)
            self.assertEqual([item["id"] for item in visible["sources"]], [source["id"]])
            yield NS(
                type="response.output_text.delta",
                delta='{"text":"This needs another source.","source_ids":["S999999"]}],"follow_ups":[],"links":[]}',
            )
            turn.refresh_from_db()
            self.assertNotIn("This needs another source.", turn.answer)
            yield NS(type="response.completed", response=NS(output=[], output_text=json.dumps(complete)))

        factory.return_value.responses.create.return_value = events()
        run_turn(turn)
        turn.refresh_from_db()
        self.assertEqual(turn.status, "complete")
        self.assertIn("[source unavailable]", turn.answer)
        self.assertTrue(factory.return_value.responses.create.call_args.kwargs["stream"])

    def test_internal_navigation_paths_are_allowlisted(self):
        self.assertEqual(
            safe_internal_path("/day/3?tab=commentary#note-8"),
            "/day/3?tab=commentary#note-8",
        )
        self.assertEqual(
            safe_internal_path("/commentaries?day=3#commentary-12"),
            "/commentaries?day=3#commentary-12",
        )
        self.assertEqual(safe_internal_path("https://example.com/day/3"), "")
        self.assertEqual(safe_internal_path("//example.com/day/3"), "")
        self.assertEqual(safe_internal_path("/admin/people"), "")

    def test_local_navigation_and_member_lookups_use_the_fast_path(self):
        self.assertTrue(
            local_fast_path("Can you link me to whatever day Noah's ark is covered?")
        )
        self.assertTrue(
            navigation_fast_path("Can you link me to whatever day Noah's ark is covered?")
        )
        self.assertTrue(local_fast_path("Has anyone shared a reflection on this?"))
        self.assertFalse(navigation_fast_path("Has anyone shared a reflection on this?"))
        self.assertTrue(local_fast_path("What did Fr. Mike say about sacrifice?"))
        self.assertFalse(local_fast_path("How does Catholic teaching understand grace?"))
        self.assertEqual(
            local_lookup_query("Can you link me to whatever day Noah's ark is covered?"),
            "noah ark",
        )

    def test_reading_day_lookup_returns_direct_navigation_sources(self):
        day = Day.objects.create(number=3, era=self.day.era, readings=["Genesis 5-6"])
        Episode.objects.create(
            guid="noah-ark",
            day=day,
            title="Day 3: Noah's Ark",
            description="Noah builds the ark before the flood.",
            published_at=timezone.now(),
            source_date="2025-01-03",
        )

        result = find_reading_days("noah ark")

        self.assertEqual([source["id"] for source in result["sources"]], ["D3"])
        self.assertEqual(result["sources"][0]["url"], "/day/3?tab=commentary")
        self.assertEqual(result["sources"][0]["metadata"]["day"], 3)

    def note(self, **kwargs):
        return Note.objects.create(
            user=kwargs.pop("user", self.user),
            day=self.day,
            body="A reflection on the Eucharist and sacrifice.",
            **kwargs,
        )

    def test_private_notes_never_enter_another_members_search(self):
        own = self.note()
        hidden = self.note(user=self.other)
        shared = self.note(user=self.other, shared=True)
        ids = {c.note_id for c in accessible_chunks(self.user)}
        self.assertEqual(ids, {own.pk, shared.pk})
        result = search_site(self.user, "Eucharist", "community")
        self.assertEqual(len(result["sources"]), 1)
        self.assertNotIn(f"note:{hidden.pk}", str(result))

    def test_note_inherits_reading_context_without_naming_the_passage(self):
        note = Note.objects.create(
            user=self.other,
            day=self.day,
            shared=True,
            body='Fiat lux is Latin for "let there be light".',
        )
        for i in range(12):
            Note.objects.create(
                user=self.other,
                day=self.day2,
                shared=True,
                body=f"Genesis 1 raises question {i} for me.",
            )
        result = search_site(self.user, "Genesis 1", "community", limit=1)
        self.assertEqual([s["key"] for s in result["sources"]], [f"note:{note.pk}:0"])
        self.assertEqual(result["sources"][0]["text"], note.body)

    def test_reading_notes_use_parent_ranges_and_live_permissions(self):
        self.day.readings = ["Genesis 1:3-2:2", "Psalm 1"]
        self.day.save()
        shared = self.note(user=self.other, shared=True)
        self.note(user=self.other)  # Private note must not enter counts or evidence.
        own = self.note()
        result = reading_notes(self.user, reference="Genesis 1:3", audience="community")
        self.assertEqual(result["accessible_note_count"], 1)
        self.assertEqual(result["sources"][0]["key"], f"note:{shared.pk}:0")
        self.assertEqual(result["matching_days"], [1])
        self.assertEqual(
            reading_notes(self.user, reference="Genesis 1:1")["accessible_note_count"],
            0,
        )
        self.assertEqual(
            reading_notes(self.user, day=1, audience="mine")["sources"][0]["key"],
            f"note:{own.pk}:0",
        )
        shared.shared = False
        shared.save()
        self.assertEqual(
            reading_notes(self.user, reference="Genesis 1", audience="community")[
                "accessible_note_count"
            ],
            0,
        )

    def test_reading_notes_paginate_and_report_unindexed_notes(self):
        for _ in range(21):
            self.note()
        first = reading_notes(self.user, day=1)
        second = reading_notes(self.user, day=1, offset=first["next_offset"])
        self.assertEqual(len(first["sources"]), 20)
        self.assertEqual(len(second["sources"]), 1)
        self.assertIsNone(second["next_offset"])
        SearchChunk.objects.all().delete()
        result = reading_notes(self.user, day=1)
        self.assertEqual(result["missing_index_count"], 21)
        self.assertEqual(result["accessible_note_count"], 21)

    def test_editing_day_refreshes_note_context(self):
        note = self.note()
        self.day.readings = ["Exodus 2"]
        self.day.save()
        self.assertEqual(
            SearchChunk.objects.get(note=note).metadata["readings"], ["Exodus 2"]
        )
        self.assertFalse(search_site(self.user, "Genesis 1", "community")["sources"])

    def test_keyword_search_excludes_nonmatches(self):
        self.note(shared=True)
        self.assertEqual(
            search_site(self.user, "unrelated zebra", "community")["sources"], []
        )

    @override_settings(OPENAI_API_KEY="test", STUDY_EMBEDDING_MODEL="test")
    @patch("study.search.client")
    def test_keyword_only_search_skips_the_embedding_request(self, factory):
        self.note(shared=True)
        SearchChunk.objects.update(
            embedding=[0.1] * 1536, embedding_model="test"
        )

        result = search_site(
            self.user, "Eucharist", kind="community", semantic=False
        )

        self.assertEqual(len(result["sources"]), 1)
        self.assertIsNone(result["notice"])
        factory.assert_not_called()

    def test_episode_note_inherits_its_days_readings(self):
        ep = Episode.objects.create(
            guid="notes",
            day=self.day,
            title="Creation",
            published_at=timezone.now(),
            source_date="2025-01-01",
        )
        note = Note.objects.create(
            user=self.other,
            episode=ep,
            shared=True,
            body="Let there be light is Fiat Lux.",
        )
        result = reading_notes(self.user, reference="Genesis 1", audience="community")
        self.assertEqual(result["accessible_note_count"], 1)
        self.assertEqual(result["sources"][0]["metadata"]["day"], 1)
        self.assertEqual(
            result["sources"][0]["url"], f"/episode/{ep.pk}#note-{note.pk}"
        )

    def test_conversation_history_is_user_and_reading_scoped(self):
        wanted = StudyConversation.objects.create(user=self.user, day=self.day)
        StudyConversation.objects.create(user=self.user, day=self.day2)
        StudyConversation.objects.create(user=self.other, day=self.day)
        result = self.client.get("/api/chat/conversations?day=1")
        self.assertEqual([c["id"] for c in result.json()["items"]], [wanted.pk])
        self.assertFalse(result.json()["has_more"])

    def test_conversation_history_pages_and_deletes_older_items(self):
        ids = []
        for number in range(23):
            conversation = StudyConversation.objects.create(user=self.user, day=self.day)
            StudyTurn.objects.create(
                conversation=conversation,
                request_id=uuid4(),
                question=f"Question {number}",
            )
            ids.append(conversation.pk)
        first = self.client.get("/api/chat/conversations?day=1&page=1").json()
        second = self.client.get("/api/chat/conversations?day=1&page=2").json()
        self.assertEqual(
            [item["id"] for item in first["items"]], list(reversed(ids[-20:]))
        )
        self.assertEqual(
            [item["id"] for item in second["items"]], list(reversed(ids[:3]))
        )
        self.assertTrue(first["has_more"])
        self.assertFalse(second["has_more"])
        self.assertEqual(second["items"][0]["title"], "Question 2")
        self.assertIn("last_activity", second["items"][0])
        self.assertEqual(
            self.client.delete(f"/api/chat/conversations/{ids[0]}").status_code,
            200,
        )
        second_after_delete = self.client.get(
            "/api/chat/conversations?day=1&page=2"
        ).json()
        self.assertNotIn(ids[0], [item["id"] for item in second_after_delete["items"]])

    def test_catechism_history_uses_edition_and_day(self):
        catechism_day = CatechismDay.objects.create(
            number=1, part="Creed", color="#123f34"
        )
        wanted = StudyConversation.objects.create(
            user=self.user, edition="catechism", catechism_day=catechism_day
        )
        StudyConversation.objects.create(user=self.user, day=self.day)
        StudyConversation.objects.create(
            user=self.other, edition="catechism", catechism_day=catechism_day
        )
        result = self.client.get("/api/chat/conversations?day=1&edition=catechism")
        self.assertEqual([item["id"] for item in result.json()["items"]], [wanted.pk])
        all_history = self.client.get("/api/chat/conversations?all_editions=true")
        self.assertEqual(len(all_history.json()["items"]), 2)

    def test_sharing_revocation_removes_evidence_and_old_answer(self):
        note = self.note(user=self.other, shared=True)
        source = search_site(self.user, "Eucharist")["sources"][0]
        source["used"] = True
        c = StudyConversation.objects.create(user=self.user)
        turn = StudyTurn.objects.create(
            conversation=c,
            request_id=uuid4(),
            question="What?",
            answer="Private reflection",
            follow_ups=["What did that private reflection mean?"],
            sources=[source],
            status="complete",
        )
        note.shared = False
        note.save()
        self.assertFalse(sources_current(self.user, [source]))
        data = turn_data(turn, self.user)
        self.assertEqual(data["sources"], [])
        self.assertEqual(data["follow_ups"], [])
        self.assertNotIn("Private reflection", data["answer"])

    def test_edit_and_delete_invalidate_old_evidence_immediately(self):
        note = self.note()
        source = search_site(self.user, "Eucharist")["sources"][0]
        note.body = "Completely revised reflection."
        note.save()
        self.assertFalse(sources_current(self.user, [source]))
        self.assertFalse(search_site(self.user, "Eucharist")["sources"])
        note.delete()
        self.assertEqual(SearchChunk.objects.count(), 0)

    def test_idempotent_rebuild_keeps_embedding(self):
        note = self.note()
        SearchChunk.objects.update(embedding=[0.1] * 1536, embedding_model="test")
        index_note(note)
        self.assertIsNotNone(SearchChunk.objects.get().embedding)
        self.assertEqual(SearchChunk.objects.count(), 1)

    def test_original_commentary_only_and_source_reference(self):
        ep = Episode.objects.create(
            guid="test",
            day=self.day,
            title="Beginnings",
            published_at=timezone.now(),
            source_date="2025-01-01",
            status="ready",
            transcript=[
                {"id": 1, "text": "Scripture here", "start": 0},
                {"id": 2, "text": "Original teaching", "start": 23},
            ],
            classification=[
                {"id": 1, "kind": "scripture"},
                {"id": 2, "kind": "commentary"},
            ],
            summary="Generated text is not original commentary",
        )
        chunk = SearchChunk.objects.get(episode=ep)
        self.assertEqual(chunk.text, "Original teaching")
        self.assertEqual(chunk.metadata["audio_time"], 23)
        ep.status = "failed"
        ep.save()
        self.assertFalse(SearchChunk.objects.filter(episode=ep).exists())

    def test_scripture_chunks_keep_verse_numbers(self):
        Verse.objects.create(
            book="Genesis", chapter=1, number=1, text="In the beginning"
        )
        index_chapter("Genesis", 1)
        chunk = SearchChunk.objects.get()
        self.assertEqual(chunk.metadata["first_verse"], 1)
        self.assertIn("1. In the beginning", chunk.text)

    def test_day_filtered_search_includes_only_its_scripture(self):
        for chapter in [1, 2]:
            Verse.objects.create(
                book="Genesis", chapter=chapter, number=1, text="In the beginning"
            )
            index_chapter("Genesis", chapter)
        result = search_site(self.user, "beginning", kind="scripture", day=1)
        self.assertEqual(len(result["sources"]), 1)
        self.assertEqual(result["sources"][0]["metadata"]["chapter"], 1)

    def test_context_uses_actual_completion_not_highest_day(self):
        DayProgress.objects.create(
            user=self.user,
            day=self.day2,
            completed_at=timezone.now() - timedelta(days=2),
        )
        DayProgress.objects.create(
            user=self.user, day=self.day, completed_at=timezone.now()
        )
        context = context_for(self.user, 2)
        self.assertEqual(context["completed_days"], [2, 1])
        self.assertEqual(context["last_completed_day"], 1)
        self.assertEqual(context["current_day"], 2)

    @override_settings(OPENAI_API_KEY="test")
    @patch("study.search.client")
    def test_embedding_late_response_cannot_overwrite_edited_chunk(self, factory):
        note = self.note()

        def create(**kwargs):
            note.body = "Changed during embedding request"
            note.save()
            return NS(data=[NS(index=0, embedding=[0.1] * 1536)])

        factory.return_value.embeddings.create.side_effect = create
        self.assertTrue(embed_batch())
        self.assertIsNone(SearchChunk.objects.get().embedding)
        self.assertIsNone(SearchChunk.objects.get().leased_until)

    @override_settings(OPENAI_API_KEY="test")
    @patch("study.search.client")
    def test_embedding_failure_is_durable_and_redacted(self, factory):
        self.note()
        factory.return_value.embeddings.create.side_effect = RuntimeError(
            "secret request text"
        )
        self.assertTrue(embed_batch())
        chunk = SearchChunk.objects.get()
        self.assertEqual(chunk.attempts, 1)
        self.assertEqual(chunk.error, "RuntimeError")
        self.assertGreater(chunk.available_at, timezone.now())
        self.assertFalse(embed_batch())

    def test_chat_endpoints_require_auth_and_owner(self):
        c = StudyConversation.objects.create(user=self.other)
        self.assertEqual(
            self.client.get(f"/api/chat/conversations/{c.pk}").status_code, 404
        )
        self.assertEqual(
            self.client.delete(f"/api/chat/conversations/{c.pk}").status_code, 404
        )
        self.client.logout()
        self.assertEqual(self.client.get("/api/chat/status").status_code, 401)

    def test_missing_key_explicit(self):
        result = self.client.post(
            "/api/chat/ask",
            data=json.dumps({"question": "Hello", "request_id": str(uuid4())}),
            content_type="application/json",
        )
        self.assertEqual(result.status_code, 503)

    @override_settings(OPENAI_API_KEY="test")
    def test_queue_deduplicates_and_requires_worker(self):
        payload = {"question": "Yesterday?", "request_id": str(uuid4()), "day": 2}

        def post():
            return self.client.post(
                "/api/chat/ask",
                data=json.dumps(payload),
                content_type="application/json",
            )

        self.assertEqual(post().status_code, 503)
        StudyWorker.objects.create(name="test", heartbeat_at=timezone.now())
        first = post()
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json(), post().json())
        self.assertEqual(StudyTurn.objects.count(), 1)
        payload["request_id"] = str(uuid4())
        self.assertEqual(post().status_code, 409)

    @override_settings(OPENAI_API_KEY="test", STUDY_CHAT_DAILY_LIMIT=1)
    def test_daily_limit(self):
        StudyWorker.objects.create(name="test", heartbeat_at=timezone.now())
        c = StudyConversation.objects.create(user=self.user)
        StudyTurn.objects.create(
            conversation=c, question="first", request_id=uuid4(), status="complete"
        )
        r = self.client.post(
            "/api/chat/ask",
            data=json.dumps({"question": "next", "request_id": str(uuid4())}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 429)

    @patch("study.chat.run_turn")
    def test_worker_marks_failure_without_leaking_provider_body(self, run):
        c = StudyConversation.objects.create(user=self.user)
        turn = StudyTurn.objects.create(
            conversation=c, question="test", request_id=uuid4(), answer="unfinished"
        )
        run.side_effect = RuntimeError("secret material")
        self.assertTrue(process_chat())
        turn.refresh_from_db()
        self.assertEqual(turn.status, "failed")
        self.assertEqual(turn.answer, "")
        self.assertNotIn("secret", turn.error)

    @patch("study.chat.run_turn")
    def test_worker_explains_provider_rate_limit(self, run):
        c = StudyConversation.objects.create(user=self.user)
        turn = StudyTurn.objects.create(
            conversation=c, question="test", request_id=uuid4()
        )
        response = httpx.Response(
            429, request=httpx.Request("POST", "https://api.openai.com/v1/responses")
        )
        run.side_effect = RateLimitError("provider detail", response=response, body=None)
        self.assertTrue(process_chat())
        turn.refresh_from_db()
        self.assertEqual(turn.status, "failed")
        self.assertIn("rate-limited", turn.error)
        self.assertNotIn("provider detail", turn.error)

    @override_settings(MAGISTERIUM_API_KEY="test")
    @patch("study.chat.httpx.post")
    def test_magisterium_preserves_citations_and_sanitizes_urls(self, post):
        post.return_value.json.return_value = {
            "citations": [
                {
                    "cited_text": "Teaching text",
                    "document_title": "Catechism",
                    "document_reference": "1324",
                    "source_url": "javascript:bad()",
                }
            ]
        }
        result = catholic_sources("Eucharist")
        self.assertEqual(result["sources"][0]["text"], "Teaching text")
        self.assertEqual(result["sources"][0]["url"], "")

    @patch("study.chat.client")
    def test_site_only_turn_has_no_external_tools_and_rejects_fake_citation(
        self, factory
    ):
        self.note()
        c = StudyConversation.objects.create(user=self.user, day=self.day)
        turn = StudyTurn.objects.create(
            conversation=c,
            request_id=uuid4(),
            question="Eucharist",
            web_enabled=False,
            status="running",
        )
        factory.return_value.responses.create.return_value = NS(
            output=[],
            output_text=json.dumps(
                {
                    "paragraphs": [
                        {"text": "Answer", "source_ids": ["S999999"]}
                    ],
                    "follow_ups": [
                        "How does this relate to the Mass?",
                        "What did Fr. Mike say?",
                    ],
                    "links": [
                        {"label": "Open Day 1", "path": "/day/1"},
                        {"label": "Unsafe", "path": "https://example.com"},
                    ],
                }
            ),
        )
        run_turn(turn)
        turn.refresh_from_db()
        self.assertEqual(turn.status, "complete")
        self.assertIn("[source unavailable]", turn.answer)
        self.assertEqual(turn.links, [{"label": "Open Day 1", "path": "/day/1"}])
        self.assertEqual(turn_data(turn, self.user)["links"], turn.links)
        self.assertEqual(turn_data(turn, self.user)["follow_ups"], ["How does this relate to the Mass?", "What did Fr. Mike say?"])
        kwargs = factory.return_value.responses.create.call_args.kwargs
        self.assertNotIn("consult_catholic_sources", str(kwargs["tools"]))
        self.assertFalse(kwargs["store"])

    @patch("study.chat.public_topic")
    @patch("study.chat.get_day")
    @patch("study.chat.client")
    def test_local_fast_path_does_not_prepare_outside_research(
        self, factory, get_day, topic
    ):
        c = StudyConversation.objects.create(user=self.user, day=self.day)
        turn = StudyTurn.objects.create(
            conversation=c,
            request_id=uuid4(),
            question="Can you link me to the day that covers Noah's ark?",
            web_enabled=True,
            status="running",
        )
        factory.return_value.responses.create.return_value = NS(
            output=[],
            output_text=json.dumps(
                {
                    "paragraphs": [{"text": "Open the reading day.", "source_ids": []}],
                    "follow_ups": ["What happens next?", "What is the covenant?"],
                    "links": [{"label": "Open Day 3", "path": "/day/3"}],
                }
            ),
        )

        run_turn(turn)

        topic.assert_not_called()
        get_day.assert_not_called()
        tools = factory.return_value.responses.create.call_args.kwargs["tools"]
        self.assertNotIn("prepare_outside_research", str(tools))
        turn.refresh_from_db()
        self.assertEqual(turn.links, [{"label": "Open Day 3", "path": "/day/3"}])

    def test_running_turn_exposes_source_titles_without_source_text(self):
        note = self.note(user=self.other, shared=True)
        source = search_site(
            self.user, "Eucharist", kind="community", semantic=False
        )["sources"][0]
        turn = StudyTurn.objects.create(
            conversation=StudyConversation.objects.create(user=self.user),
            request_id=uuid4(),
            question="Has anyone reflected on the Eucharist?",
            status="running",
            sources=[source],
            answer=f"A provisional answer [{source['id']}]",
        )

        data = turn_data(turn, self.user)

        self.assertEqual([item["id"] for item in data["sources"]], [source["id"]])
        self.assertIn("provisional answer", data["answer"])
        self.assertEqual(data["progress_sources"][0]["title"], source["title"])
        self.assertNotIn("text", data["progress_sources"][0])
        self.assertEqual(data["progress_sources"][0]["day"], note.day_id)
        note.shared = False
        note.save()
        hidden = turn_data(turn, self.user)
        self.assertEqual(hidden["answer"], "")
        self.assertEqual(hidden["sources"], [])

    @patch("study.chat.client")
    def test_historical_commentary_tool_is_citable(self, factory):
        author = CommentaryAuthor.objects.create(
            name="Early Witness", default_year=120, category="Early Fathers"
        )
        commentary = Commentary.objects.create(
            external_id="00000000-0000-0000-0000-000000000010",
            author=author,
            file_name="Early.toml",
            year=120,
            book_key="genesis",
            location_start=1_000_001,
            location_end=1_000_001,
            text="An early witness on creation.",
            source_title="On Genesis",
        )
        c = StudyConversation.objects.create(user=self.user, day=self.day)
        turn = StudyTurn.objects.create(
            conversation=c,
            request_id=uuid4(),
            question="How has Genesis 1:1 been interpreted historically?",
            web_enabled=False,
            status="running",
        )

        class Call:
            type = "function_call"
            call_id = "historical"
            name = "get_historical_commentaries"
            arguments = json.dumps({"reference": "Genesis 1:1", "day": None, "offset": 0})

            def model_dump(self, **kwargs):
                return {
                    "type": self.type,
                    "name": self.name,
                    "arguments": self.arguments,
                    "call_id": self.call_id,
                }

        factory.return_value.responses.create.side_effect = [
            NS(output=[Call()]),
            NS(
                output=[],
                output_text=json.dumps(
                    {
                        "paragraphs": [
                            {
                                "text": "An early witness reads this as a claim about creation.",
                                "source_ids": [f"H{commentary.pk}"],
                            }
                        ],
                        "follow_ups": [
                            "What other witnesses comment on this passage?",
                            "How does this compare with modern interpretation?",
                        ],
                    }
                ),
            ),
        ]

        run_turn(turn)

        turn.refresh_from_db()
        self.assertEqual(turn.status, "complete")
        self.assertIn(f"[H{commentary.pk}]", turn.answer)
        self.assertEqual(turn.sources[0]["kind"], "historical_commentary")
        self.assertIn("get_historical_commentaries", str(factory.return_value.responses.create.call_args_list[0].kwargs["tools"]))

    def test_csrf_protects_chat_submission(self):
        from django.test import Client

        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        response = client.post(
            "/api/chat/ask",
            data=json.dumps({"question": "hello", "request_id": str(uuid4())}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    @override_settings(OPENAI_API_KEY="test")
    @patch("study.search.client")
    def test_expired_embedding_lease_is_recovered(self, factory):
        self.note()
        SearchChunk.objects.update(leased_until=timezone.now() - timedelta(minutes=1))
        factory.return_value.embeddings.create.return_value = NS(
            data=[NS(index=0, embedding=[0.1] * 1536)]
        )
        self.assertTrue(embed_batch())
        self.assertIsNotNone(SearchChunk.objects.get().embedding)

    @patch("study.chat.web_sources")
    @patch("study.chat.catholic_sources")
    @patch("study.chat.public_topic", return_value="Eucharist")
    @patch("study.chat.client")
    def test_external_tools_are_sequenced_and_never_receive_local_note_text(
        self, factory, topic, catholic, web
    ):
        self.note()
        c = StudyConversation.objects.create(user=self.user)
        turn = StudyTurn.objects.create(
            conversation=c, request_id=uuid4(), question="Eucharist?", status="running"
        )

        class Call:
            type = "function_call"
            arguments = "{}"

            def __init__(self, name):
                self.name, self.call_id = name, name

            def model_dump(self, **kwargs):
                return {
                    "type": self.type,
                    "name": self.name,
                    "arguments": self.arguments,
                    "call_id": self.call_id,
                }

        factory.return_value.responses.create.side_effect = [
            NS(output=[Call("prepare_outside_research")]),
            NS(output=[Call("consult_catholic_sources")]),
            NS(output=[Call("search_open_web")]),
            NS(
                output=[],
                output_text=json.dumps(
                    {
                        "paragraphs": [
                            {"text": "Grounded answer", "source_ids": ["M1", "W1"]}
                        ]
                    }
                ),
            ),
        ]
        catholic.return_value = {
            "sources": [{"id": "M1", "text": "Primary teaching", "kind": "magisterium"}]
        }
        web.return_value = {
            "sources": [{"id": "W1", "text": "Web finding", "kind": "web"}]
        }
        run_turn(turn)
        calls = factory.return_value.responses.create.call_args_list
        self.assertNotIn("search_open_web", str(calls[0].kwargs["tools"]))
        self.assertNotIn("consult_catholic_sources", str(calls[0].kwargs["tools"]))
        self.assertIn("consult_catholic_sources", str(calls[1].kwargs["tools"]))
        self.assertIn("search_open_web", str(calls[2].kwargs["tools"]))
        catholic.assert_called_once_with("Eucharist")
        web.assert_called_once_with("Eucharist")
        topic.assert_called_once_with("Eucharist?")
        turn.refresh_from_db()
        self.assertEqual(turn.status, "complete")


class CanonicalBibleImportTests(TestCase):
    def test_esther_file_order_is_not_chapter_number(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        from django.core.management import call_command

        with TemporaryDirectory() as directory:
            Path(directory, "19_es_text_7.html").write_text(
                '<verse id="v19004008"><verse_body>First passage</verse_body></verse>'
                '<verse id="v19013008"><verse_body>Prayer passage</verse_body></verse>'
            )
            call_command("import_bible", source=directory)
        self.assertEqual(
            set(Verse.objects.values_list("book", "chapter", "number")),
            {("Esther", 4, 8), ("Esther", 13, 8)},
        )
        self.assertEqual(SearchChunk.objects.count(), 2)
