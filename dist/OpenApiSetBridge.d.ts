import { ModelSet, type ModelSetBridge } from "model-algebra-common";
import { type ModelData } from "model-algebra-typescript";
import { type OpenApiDocument, type OpenApiServer } from "./openapi.js";
export type CrudOperation = 'list' | 'create' | 'read' | 'replace' | 'update' | 'delete';
export declare const CRUD_OPERATIONS: CrudOperation[];
export interface OpenApiBridgeOptions {
    /** info.title (default: "API", or "<model> API" for one model). */
    title?: string;
    /** info.version (default: the version of the model, or 1.0.0). */
    version?: string;
    /** info.description. */
    description?: string;
    servers?: OpenApiServer[];
    /** Operations to describe (default: all). Models without a primary key only get list and create. */
    operations?: CrudOperation[];
    /** Collection paths by model name, e.g. { Person: '/people' } (default: /user-profiles for UserProfile). */
    paths?: Record<string, string>;
    /** Page size when the client gives none (default: 20). */
    defaultPageSize?: number;
    /** Largest page size a client may ask for (default: 100). */
    maxPageSize?: number;
}
/**
 * OpenAPI description of a CRUD API for a set of models, and the models back from such a description.
 *
 * For each model, e.g. User, the document has:
 * - schemas User (records as the API returns them), UserInput (to create or replace one), UserPatch (to change some
 *   fields) and UserList (a page of records);
 * - GET and POST on /users, to list records page by page and to create one;
 * - GET, PUT, PATCH and DELETE on /users/{id}, when the model has a primary key; composite keys give paths like
 *   /tickets/{eventId}/{seat}.
 *
 * The User schema carries the whole model, partly in x- extensions, so that toModel() gives it back.
 */
export declare class OpenApiSetBridge implements ModelSetBridge<OpenApiDocument> {
    private readonly options;
    constructor(options?: OpenApiBridgeOptions);
    toTarget(models: ModelSet): OpenApiDocument;
    /**
     * Reads the models from the schemas of the document. Schemas written by toTarget() are recognized by their
     * x-model extension; in documents without any, every object schema becomes a model.
     */
    toModel(document: OpenApiDocument): ModelSet;
    /** The document for the models; `title` when the options give none. */
    protected document(models: ModelData[], title: string): OpenApiDocument;
    private schemas;
    private paths;
    private pageParameters;
    private errorResponses;
    private readModel;
}
//# sourceMappingURL=OpenApiSetBridge.d.ts.map