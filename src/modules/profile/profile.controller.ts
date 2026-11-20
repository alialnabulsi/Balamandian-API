import type { RequestHandler } from 'express';
import { authenticatedSession } from '../auth/auth.middleware.js';
import type { ProfileService } from './profile.service.js';
import * as validate from './profile.validators.js';

export class ProfileController {
  constructor(private readonly service: ProfileService) {}
  own: RequestHandler = async (req, res) => {
    validate.query(req.query);
    res.json({
      data: await this.service.own(authenticatedSession(res.locals).user),
    });
  };
  update: RequestHandler = async (req, res) => {
    validate.query(req.query);
    res.json({
      data: await this.service.update(
        authenticatedSession(res.locals).user,
        validate.biography(req.body),
      ),
    });
  };
  upload: RequestHandler = async (req, res) => {
    validate.query(req.query);
    const bytes: unknown = req.body;
    res.json({
      data: await this.service.upload(
        authenticatedSession(res.locals).user,
        Buffer.isBuffer(bytes) ? bytes : Buffer.alloc(0),
      ),
    });
  };
  remove: RequestHandler = async (req, res) => {
    validate.query(req.query);
    res.json({
      data: await this.service.remove(authenticatedSession(res.locals).user),
    });
  };
  profile: RequestHandler = async (req, res) => {
    validate.query(req.query);
    res.json({
      data: await this.service.profile(
        validate.userId(req.params.userId),
        authenticatedSession(res.locals).user.id,
      ),
    });
  };
  avatar: RequestHandler = async (req, res) => {
    const fields = validate.query(req.query, ['v']);
    if (fields.v !== undefined) validate.userId(fields.v);
    res
      .type('image/webp')
      .send(await this.service.avatar(validate.userId(req.params.userId)));
  };
  follow(value: boolean): RequestHandler {
    return async (req, res) => {
      validate.query(req.query);
      res.json({
        data: await this.service.follow(
          authenticatedSession(res.locals).user,
          validate.userId(req.params.userId),
          value,
        ),
      });
    };
  }
  members(direction?: 'followers' | 'following'): RequestHandler {
    return async (req, res) => {
      res.json({
        data: await this.service.members(
          authenticatedSession(res.locals).user.id,
          validate.members(req.query),
          direction ? validate.userId(req.params.userId) : undefined,
          direction,
        ),
      });
    };
  }
}
