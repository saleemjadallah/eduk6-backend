// Input validation middleware using Zod
import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

type RequestPart = 'body' | 'query' | 'params';

/**
 * Validate request input against a Zod schema
 * @param schema - Zod schema to validate against
 * @param part - Which part of the request to validate (body, query, params)
 */
export function validateInput<T extends ZodSchema>(
  schema: T,
  part: RequestPart = 'body'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse(req[part]);
      // Replace with validated (and potentially transformed) data
      req[part] = data;
      next();
    } catch (error) {
      // Let the error handler deal with ZodError
      next(error);
    }
  };
}

/**
 * Validate multiple parts of a request
 */
export function validateRequest<
  TBody extends ZodSchema | undefined = undefined,
  TQuery extends ZodSchema | undefined = undefined,
  TParams extends ZodSchema | undefined = undefined
>(schemas: {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
