import type { Request, Response } from 'express';

import { authenticatedSession } from '../auth/auth.middleware.js';
import type { MarketplaceService } from './marketplace.service.js';
import * as validators from './marketplace.validators.js';

export class MarketplaceController {
  constructor(private readonly service: MarketplaceService) {}

  categories = async (request: Request, response: Response) => {
    validators.emptyQuery(request.query);
    response.json({ data: await this.service.categories() });
  };

  places = async (request: Request, response: Response) => {
    response.json({
      data: await this.service.places(
        authenticatedSession(response.locals).user.id,
        validators.places(request.query),
      ),
    });
  };

  place = async (request: Request, response: Response) => {
    validators.emptyQuery(request.query);
    response.json({
      data: await this.service.place(
        authenticatedSession(response.locals).user.id,
        validators.placeId(request.params.placeId),
      ),
    });
  };

  posts = async (request: Request, response: Response) => {
    response.json({
      data: await this.service.posts(
        authenticatedSession(response.locals).user.id,
        validators.posts(request.query),
      ),
    });
  };

  favorite(value: boolean) {
    return async (request: Request, response: Response) => {
      validators.emptyQuery(request.query);
      response.json({
        data: await this.service.favorite(
          authenticatedSession(response.locals).user.id,
          validators.placeId(request.params.placeId),
          value,
        ),
      });
    };
  }

  rating(remove: boolean) {
    return async (request: Request, response: Response) => {
      validators.emptyQuery(request.query);
      response.json({
        data: await this.service.rating(
          authenticatedSession(response.locals).user.id,
          validators.placeId(request.params.placeId),
          remove ? null : validators.rating(request.body),
        ),
      });
    };
  }
}
