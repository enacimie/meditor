export type Doc = {
  id: string;
  name: string;
  path: string | null;
  content: string;
  dirty: boolean;
  handle?: string;
};
