export interface AcademicIdentity {
  campus: string | null;
  admissionYear: number | null;
  programs: { name: string; department: string; faculty: string }[];
  departments: { name: string; faculty: string }[];
}
export interface IdentitySnapshot {
  firstName: string;
  lastName: string;
  roles: string[];
  academic: AcademicIdentity;
}
export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  biography: string;
  avatarPath: string | null;
  verified: boolean;
  roles: string[];
  postsCount: number;
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
  isSelf: boolean;
}
export interface OwnProfile extends PublicProfile {
  account: {
    firstName: string;
    lastName: string;
    sisId: string;
    institutionalEmail: string;
    createdAt: string;
    emailVerifiedAt: string;
    institutionalRoles: string[];
    academic: AcademicIdentity;
  };
}
export interface MemberQuery {
  search: string;
  page: number;
  limit: number;
}
export interface MemberPage {
  items: PublicProfile[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
