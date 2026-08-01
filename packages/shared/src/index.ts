/** Response shape of `GET /api/background`. */
export interface BackgroundData {
  url: string;
  location: string | null;
  photographer: string;
  photographerUrl: string;
}

/** Response shape of `GET /api/quote`. */
export interface QuoteData {
  text: string;
  author: string;
}
