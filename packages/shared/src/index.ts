/** Response shape of `GET /api/background`. */
export interface BackgroundData {
  url: string;
  location: string | null;
  photographer: string;
  photographerUrl: string;
}
