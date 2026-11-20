import type { AppUser, SisGateway } from '../auth/auth.types.js';
import { HttpError } from '../../shared/http-error.js';
import { normalizeAvatar } from './profile.avatar.js';
import { ProfileRepository, unavailable } from './profile.repository.js';
import type { MemberQuery } from './profile.types.js';

export class ProfileService {
  private readonly hydration = new Map<string, Promise<void>>();
  constructor(
    private readonly repository: ProfileRepository,
    private readonly sis: SisGateway,
  ) {}
  async own(user: AppUser) {
    let profile = await this.repository.own(user.id);
    if (!profile) {
      let pending = this.hydration.get(user.id);
      if (!pending) {
        if (this.hydration.size >= 100)
          throw new HttpError(
            503,
            'PROFILE_UNAVAILABLE',
            'Profile setup is busy. Please retry.',
          );
        pending = this.hydrate(user).finally(() =>
          this.hydration.delete(user.id),
        );
        this.hydration.set(user.id, pending);
      }
      await pending;
      profile = await this.repository.own(user.id);
    }
    return profile ?? unavailable();
  }
  private async hydrate(user: AppUser) {
    try {
      if (!this.sis.member) throw new Error('member unavailable');
      const identity = await this.sis.member(user.sisUserId);
      if (identity.userId !== user.sisUserId)
        throw new Error('identity mismatch');
      // Verified application email remains untouched, even if SIS changed it.
      await this.repository.hydrate(user.id, identity);
    } catch {
      throw new HttpError(
        503,
        'PROFILE_UNAVAILABLE',
        'Your university profile could not be loaded. Retry shortly; your session is still valid.',
      );
    }
  }
  async profile(id: string, viewer: string) {
    return (await this.repository.profile(id, viewer)) ?? unavailable();
  }
  async update(user: AppUser, biography: string) {
    await this.own(user);
    await this.repository.biography(user.id, biography);
    return this.own(user);
  }
  async avatar(id: string) {
    return (await this.repository.avatar(id)) ?? unavailable();
  }
  async upload(user: AppUser, bytes: Buffer) {
    await this.own(user);
    await this.repository.setAvatar(user.id, await normalizeAvatar(bytes));
    return this.own(user);
  }
  async remove(user: AppUser) {
    await this.own(user);
    await this.repository.setAvatar(user.id, null);
    return this.own(user);
  }
  async follow(user: AppUser, target: string, following: boolean) {
    if (user.id === target)
      throw new HttpError(400, 'SELF_FOLLOW', 'You cannot follow yourself.');
    await this.own(user);
    return this.repository.follow(user.id, target, following);
  }
  members(
    viewer: string,
    query: MemberQuery,
    target?: string,
    direction?: 'followers' | 'following',
  ) {
    return this.repository.members(viewer, query, target, direction);
  }
}
