// Static hosting can't make a page per evidence item, so items are a query parameter.
export const evidenceHref = (id: string) => `/evidence/view/?id=${encodeURIComponent(id)}`;
export const editHref = (id: string) => `/evidence/edit/?id=${encodeURIComponent(id)}`;
