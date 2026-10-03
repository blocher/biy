export type CatechismInline = {
  type: "text" | "em" | "strong" | "note" | "bible" | "item" | "row" | "cell";
  text?: string;
  id?: string;
  reference?: string | null;
  children?: CatechismInline[];
};
export type CatechismBlock = {
  kind: "paragraph" | "quote" | "heading" | "list" | "ordered_list" | "table";
  level?: number;
  children: CatechismInline[];
};
export type CatechismNote = {
  id: string;
  label: string;
  children: CatechismInline[];
};
export type CatechismContent = {
  schema?: number;
  before?: CatechismBlock[];
  blocks?: CatechismBlock[];
  notes?: CatechismNote[];
  context?: { text: string; level: number }[];
  cross_references?: number[];
};
