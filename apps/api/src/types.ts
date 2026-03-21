export interface Photo {
  id: string;
  slug: string;
  alternative_slugs: Record<string, string>;
  created_at: string;
  updated_at: string;
  promoted_at: string | null;
  width: number;
  height: number;
  color: string;
  blur_hash: string;
  description: string | null;
  alt_description: string | null;
  breadcrumbs: unknown[];
  urls: PhotoUrls;
  links: PhotoLinks;
  likes: number;
  liked_by_user: boolean;
  bookmarked: boolean;
  current_user_collections: unknown[];
  sponsorship: unknown | null;
  topic_submissions: Record<string, TopicSubmission>;
  asset_type: string;
  user: User;
  exif: Exif;
  location: Location;
  views: number;
  downloads: number;
}

export interface PhotoUrls {
  raw: string;
  full: string;
  regular: string;
  small: string;
  thumb: string;
  small_s3: string;
}

export interface PhotoLinks {
  self: string;
  html: string;
  download: string;
  download_location: string;
}

export interface TopicSubmission {
  status: string; // 'approved' | 'rejected' | 'pending' lehet
  approved_on?: string;
}

export interface User {
  id: string;
  updated_at: string;
  username: string;
  name: string;
  first_name: string;
  last_name: string | null;
  twitter_username: string | null;
  portfolio_url: string | null;
  bio: string | null;
  location: string | null;
  links: UserLinks;
  profile_image: ProfileImage;
  instagram_username: string | null;
  total_collections: number;
  total_likes: number;
  total_photos: number;
  total_free_photos: number;
  total_promoted_photos: number;
  total_illustrations: number;
  total_free_illustrations: number;
  total_promoted_illustrations: number;
  accepted_tos: boolean;
  for_hire: boolean;
  social: Social;
}

export interface UserLinks {
  self: string;
  html: string;
  photos: string;
  likes: string;
  portfolio: string;
}

export interface ProfileImage {
  small: string;
  medium: string;
  large: string;
}

export interface Social {
  instagram_username: string | null;
  portfolio_url: string | null;
  twitter_username: string | null;
  paypal_email: string | null;
}

export interface Exif {
  make: string | null;
  model: string | null;
  name: string | null;
  exposure_time: string | null;
  aperture: string | null;
  focal_length: string | null;
  iso: number | null;
}

export interface Location {
  name: string | null;
  city: string | null;
  country: string | null;
  position: Position;
}

export interface Position {
  latitude: number | null;
  longitude: number | null;
}
