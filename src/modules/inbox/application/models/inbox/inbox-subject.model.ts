/** Exact resource selector retained with an inbox notification. */
export type InboxSubject =
  | { readonly kind: 'task-key'; readonly taskKey: string }
  | { readonly kind: 'task-id'; readonly taskId: string }
  | { readonly kind: 'space'; readonly spaceId: string }
  | { readonly kind: 'list'; readonly listId: string }
  | null;
