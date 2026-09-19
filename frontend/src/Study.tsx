import {useEffect,useState,type ReactNode} from 'react'
import {Link,useParams,useSearchParams} from 'react-router-dom'
import {ArrowLeft,ArrowRight,Check,Headphones,Maximize2,Play,BookOpen,Minus,Plus,X} from 'lucide-react'
import {api,date,episodeTitle,time} from './api'
import type {DayDetail,Episode,Segment} from './types'
import {Design} from './Design'
import studySource from './design/study.html?raw'
import readerSource from './design/reader.html?raw'
import {useAudio} from './Audio'
import {Notes} from './Notes'
import {Scripture} from './Scripture'
import {Sidebar} from './navigation'
export function Study({user,onError,onChange,reader=false}:{user:string;onError:(e:string)=>void;onChange:()=>void;reader?:boolean}){
 const params=useParams(),isDay=!!params.day,target=isDay?`/days/${params.day}`:`/episodes/${params.episode}`
 const [data,setData]=useState<DayDetail|Episode|null>(null),[failure,setFailure]=useState(''),[search,setSearch]=useSearchParams(),[size,setSize]=useState(()=>Number(localStorage.getItem('biy-font-size'))||20),[saving,setSaving]=useState(false)
 const tab=search.get('tab')||'scripture',audio=useAudio()
 useEffect(()=>{let live=true;setData(null);setFailure('');api<DayDetail|Episode>(target).then(result=>{if(live)setData(result)}).catch(e=>{if(live)setFailure(e.message)});return()=>{live=false}},[target])
 useEffect(()=>{window.scrollTo(0,0)},[target,reader])
 useEffect(()=>{const before=document.title;document.title=data?`${isDay?`Day ${(data as DayDetail).number}`:episodeTitle((data as Episode).title)} · Bible in a Year`:'Bible in a Year';return()=>{document.title=before}},[data,isDay])
 if(failure)return <div className="app-frame"><Sidebar user={user}/><main className="simple-page"><h1>Couldn’t open this study</h1><p role="alert">{failure}</p><Link to="/">Back to reading plan</Link></main></div>
 if(!data)return <div className="app-frame"><Sidebar user={user}/><main className="simple-page"><p role="status">Opening your study…</p></main></div>
 const day=isDay?data as DayDetail:null,episode=day?day.episode:data as Episode,base=day?`/day/${day.number}`:`/episode/${episode!.id}`
 const title=episode?episodeTitle(episode.title):day!.readings[0],completed=data.completed_at
 async function complete(){setSaving(true);try{const result=await api<{completed_at:string|null}>(target+'/completion','PUT',{completed:!completed});setData(current=>current?{...current,completed_at:result.completed_at}:current);onChange()}catch(e){onError((e as Error).message)}finally{setSaving(false)}}
 const completion=<button className={completed?'completed-button':'primary'} disabled={saving} onClick={complete}><Check size={17}/>{saving?'Saving…':completed?'Completed':'Mark complete'}</button>
 const empty=<div className="empty-content"><Headphones size={28}/><h3>{episode?.status==='failed'?'Study processing needs attention':'Your study is waiting'}</h3><p>{episode?.has_audio?'The audio is ready to listen to. Transcripts, commentary, and the study guide will appear after processing.':'This episode has not been imported yet. You can still read available Scripture and keep notes.'}</p></div>
 function transcript(segments:Segment[]|undefined){return segments?.length?<div className="transcript-list">{segments.map(s=><article className={'transcript-segment '+(audio.episode?.id===episode?.id&&audio.position>=s.start&&audio.position<s.end?'current':'')} key={s.id}><div className="segment-meta"><button className="timestamp" onClick={()=>episode&&audio.play(episode,s.start)}><Play size={12}/>{time(s.start)}</button><span>{s.speaker}</span>{s.partial&&<small>Excerpt · timestamp starts this segment</small>}</div><p>{s.text}</p></article>)}</div>:empty}
 const tabs=[['scripture','Scripture'],['transcript','Full transcript'],['commentary','Commentary only'],['edited','Edited commentary']].filter(([key])=>day||key!=='scripture')
 const selected=tabs.some(([key])=>key===tab)?tab:'transcript'
 const content=selected==='scripture'&&day?<Scripture passages={day.scripture}/>:selected==='transcript'?transcript(episode?.transcript):selected==='commentary'?<><p className="view-note">Original commentary and prayer, with Scripture readings and promotional material removed. Brief Scripture quotations within the teaching are retained.</p>{transcript(episode?.commentary)}</>:<>{episode?.edited_commentary?.length?<div className="edited-text"><p className="view-note">Lightly edited for reading. AI-assisted; compare with the original audio for exact wording.</p>{episode.edited_commentary.map((p,i)=><section key={i}>{p.heading&&<h2>{p.heading}</h2>}<p>{p.text}</p><button className="text-link" onClick={()=>{const source=episode.transcript?.find(s=>s.id===p.segment_ids[0]);if(source)audio.play(episode,source.start)}}><Headphones size={14}/> Listen to source</button></section>)}</div>:empty}</>
 const readerControls=<div className="reader-controls"><Link to={`${base}?tab=${selected}`}><X size={18}/> Exit reader</Link><div className="font-controls"><button aria-label="Smaller text" disabled={size<=16} onClick={()=>{setSize(size-2);localStorage.setItem('biy-font-size',String(size-2))}}><Minus size={16}/></button><span>Aa</span><button aria-label="Larger text" disabled={size>=30} onClick={()=>{setSize(size+2);localStorage.setItem('biy-font-size',String(size+2))}}><Plus size={16}/></button></div>{completion}</div>
 if(reader)return <div style={{'--reading-size':`${size}px`} as React.CSSProperties}><Design source={readerSource} className="reader-design" bindings={{
 'viewport-1-c-top-nav':readerControls,
 'viewport-1-c-header':<><span className="eyebrow">{day?`DAY ${day.number}`:'SUPPLEMENTARY EPISODE'} · READER</span><h1>{selected==='scripture'?day?.readings.join(' and '):title}</h1></>,
 'viewport-1-c-accessibility':null,
 'viewport-1-c-passage-tabs':<nav className="reader-passages">{selected==='scripture'&&day?.readings.map((r,i)=><a href={`#passage-${i}`} key={r}>{r}</a>)}</nav>,
 'viewport-1-c-reader':content,
 'viewport-1-c-footer-nav':<Link className="text-link" to={`${base}?tab=${selected}`}><ArrowLeft size={16}/> Back to study</Link>,
 }}/></div>
 const bindings:Record<string,ReactNode>={
 'viewport-1-a-app':null,
 'viewport-1-a-sidebar':<Sidebar user={user} embedded/>,
 'viewport-1-a-header':<><Link className="back-link" to="/"><ArrowLeft size={15}/> Reading plan</Link><span className="quiet">{episode?date(episode.published_at):'Your daily companion'}</span></>,
 'viewport-1-a-hero-title':<><span className="eyebrow" style={{color:day?.color||episode?.color}}>{day?`DAY ${day.number} OF 365`:'SUPPLEMENTARY EPISODE'} · {data.era||'BIBLE IN A YEAR'}</span><h1>{title}</h1></>,
 'viewport-1-a-hero-meta':<><p>{day?.readings.join(' · ')||'Conversation, context, and reflection'}</p><div className="completion-row">{completion}{completed&&<span className="quiet">{date(completed)}</span>}</div></>,
 'viewport-1-a-audio':<div className="listen-row"><button className="primary" disabled={!episode?.has_audio} onClick={()=>episode&&audio.play(episode)}><Play size={17}/>{episode?.position?'Resume listening':'Listen to episode'}</button><span className="quiet">{episode?.has_audio?`${Math.ceil(episode.duration/60)} min · 2025 edition`:'Audio not imported yet'}</span></div>,
 'viewport-1-a-summary':<><span className="eyebrow">AT A GLANCE</span><h2>Today’s study</h2><p>{episode?.summary||'Your episode summary will appear here once the audio has been processed. Scripture and your private journal are available independently.'}</p></>,
 'viewport-1-a-outline':<><div className="section-heading"><h2>Listen & explore</h2><Headphones size={20}/></div>{episode?.outline?.length?<ol className="outline">{episode.outline.map((item,i)=><li key={i}><button onClick={()=>audio.play(episode,item.start)}><span className="outline-number">{i+1}</span><strong>{item.title}</strong><span className="timestamp">{time(item.start)} <Play size={12}/></span></button></li>)}</ol>:<p className="quiet empty">A clickable outline will be generated from this episode’s commentary.</p>}</>,
 'viewport-1-a-transcript':<div className="preview-panel"><div className="section-heading"><h2>Read along</h2><BookOpen size={20}/></div>{episode?.transcript?.length?transcript(episode.transcript.slice(0,3)):<><p className="serif">A little each day.<br/>Space to listen, learn, and reflect.</p><p className="quiet">The full transcript will include speaker labels and clickable timestamps.</p></>}<button className="text-link" onClick={()=>{setSearch({tab:'transcript'});document.getElementById('viewport-2-b')?.scrollIntoView({behavior:'smooth'})}}>Open full transcript <ArrowRight size={16}/></button></div>,
 'viewport-2-b-app':null,'viewport-2-b-sidebar':null,'viewport-2-b-hero':null,'viewport-2-b-header':null,'viewport-2-b-content':null,'viewport-2-b-sidebar-content':null,
 'viewport-2-b-tabs':<div className="study-tabs" role="tablist" aria-label="Study content">{tabs.map(([id,label])=><button role="tab" id={`tab-${id}`} aria-selected={selected===id} aria-controls="study-panel" className={selected===id?'active':''} key={id} onClick={()=>setSearch({tab:id},{replace:true})}>{label}</button>)}</div>,
 'viewport-2-b-commentary':<div id="study-panel" role="tabpanel" aria-labelledby={`tab-${selected}`}><div className="content-toolbar"><span className="eyebrow">{selected==='scripture'?'RSV SECOND CATHOLIC EDITION':selected==='edited'?'WRITTEN FOR REFLECTION':'LISTEN • READ • REFLECT'}</span><Link to={`${base}/reader?tab=${selected}`}><Maximize2 size={15}/> Reader mode</Link></div>{content}</div>,
 'viewport-2-b-scripture-card':<><h2>{day?'Today’s Scripture':'A deeper conversation'}</h2>{day?<ul className="readings-list">{day.readings.map(r=><li key={r}><BookOpen size={16}/>{r}</li>)}</ul>:<p>This supplementary episode has the same study tools and private reflections as a daily episode.</p>}<Link className="text-link" to={`${base}/reader?tab=${day?'scripture':'edited'}`}>Open full-page reader <ArrowRight size={16}/></Link></>,
 'viewport-2-b-journal':<Notes target={target} user={user} episode={episode} onError={onError}/>,
 'viewport-2-b-audio-button':<div className="day-navigation">{day&&day.number>1&&<Link to={`/day/${day.number-1}`}><ArrowLeft size={16}/> Day {day.number-1}</Link>}{day&&day.number<365&&<Link to={`/day/${day.number+1}`}>Day {day.number+1}<ArrowRight size={16}/></Link>}</div>,
 }
 return <Design source={studySource} bindings={bindings} className="study-design"/>
}
