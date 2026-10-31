import { Model, ModelSet, type ModelSetBridge } from "model-algebra-common";
import { toModelData, type FieldData, type ModelData } from "model-algebra-typescript";
import { collectionPath, componentName, plural } from "./names.js";
import { OPENAPI_VERSION, type JsonSchema, type OpenApiDocument, type OpenApiServer } from "./openapi.js";
import { fieldSchema, parameterSchema, readField, withoutExtensions, type RefResolver } from "./schemas.js";

export type CrudOperation = 'list' | 'create' | 'read' | 'replace' | 'update' | 'delete';

export const CRUD_OPERATIONS: CrudOperation[] = ['list', 'create', 'read', 'replace', 'update', 'delete'];

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

const JSON_CONTENT = 'application/json';
const PROBLEM_CONTENT = 'application/problem+json';

/** RFC 9457 problem details, the body of error responses. */
const PROBLEM_SCHEMA: JsonSchema = {
    type: 'object',
    description: 'Problem details (RFC 9457)',
    properties: {
        type: { type: 'string', format: 'uri-reference' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        instance: { type: 'string', format: 'uri-reference' },
    },
};

const ERROR_RESPONSES: Record<string, string> = {
    BadRequest: 'The request is not valid',
    NotFound: 'There is no such record',
    Conflict: 'The record conflicts with another one, e.g. a duplicate unique value',
};

const problem = (name: string) => ({ $ref: `#/components/responses/${name}` });
const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: JsonSchema) => ({ [JSON_CONTENT]: { schema } });

/** Fields that identify a record: the primary key field, or the fields of the primaryKey table constraint. */
function keyFields(model: ModelData): FieldData[] {
    const fields = model.fields.filter(field => field.constraints?.primaryKey === true);
    if (fields.length > 0) return fields;
    const constraint = model.constraints?.find(c => c.type === 'primaryKey');
    return (constraint?.fields ?? []).map(name => {
        const field = model.fields.find(f => f.name === name);
        if (field === undefined) throw new Error(`Primary key of ${model.metadata.name} names unknown field ${name}`);
        return field;
    });
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
export class OpenApiSetBridge implements ModelSetBridge<OpenApiDocument> {
    constructor(private readonly options: OpenApiBridgeOptions = {}) {}

    toTarget(models: ModelSet): OpenApiDocument {
        return this.document(models.models.map(model => toModelData(model)), this.options.title ?? 'API');
    }

    /**
     * Reads the models from the schemas of the document. Schemas written by toTarget() are recognized by their
     * x-model extension; in documents without any, every object schema becomes a model.
     */
    toModel(document: OpenApiDocument): ModelSet {
        const schemas = document.components?.schemas ?? {};
        const marked = Object.entries(schemas).filter(([, schema]) => schema['x-model'] !== undefined);
        const entries = marked.length > 0
            ? marked
            : Object.entries(schemas).filter(([, schema]) => schema.type === 'object' && schema.properties !== undefined);
        const modelName = (ref: string) => {
            const name = ref.replace(/^#\/components\/schemas\//, '');
            const schema = schemas[name];
            if (schema === undefined) throw new Error(`Reference ${ref} points to no schema`);
            return schema['x-model']?.name ?? name;
        };
        return new ModelSet(entries.map(([name, schema]) => new Model(this.readModel(name, schema, modelName))));
    }

    /** The document for the models; `title` when the options give none. */
    protected document(models: ModelData[], title: string): OpenApiDocument {
        const names = new Map<string, string>();
        for (const model of models) {
            const component = componentName(model.metadata.name);
            const other = [...names].find(([, c]) => c === component);
            if (other !== undefined)
                throw new Error(`Models ${other[0]} and ${model.metadata.name} would both be described by schema ${component}`);
            names.set(model.metadata.name, component);
        }
        const resolve: RefResolver = name => names.get(name);
        const version = this.options.version ?? (models.length === 1 ? models[0].metadata.version : undefined) ?? '1.0.0';

        const document: OpenApiDocument = {
            openapi: OPENAPI_VERSION,
            info: { title, version, ...(this.options.description !== undefined ? { description: this.options.description } : {}) },
            ...(this.options.servers !== undefined ? { servers: this.options.servers } : {}),
            tags: models.map(model => ({
                name: names.get(model.metadata.name)!,
                ...(model.metadata.description !== undefined ? { description: model.metadata.description } : {}),
            })),
            paths: {},
            components: { schemas: {}, parameters: this.pageParameters(), responses: this.errorResponses() },
        };
        for (const model of models) {
            const component = names.get(model.metadata.name)!;
            Object.assign(document.components!.schemas!, this.schemas(model, component, resolve));
            Object.assign(document.paths, this.paths(model, component, resolve));
        }
        document.components!.schemas!.Problem = PROBLEM_SCHEMA;
        return document;
    }

    private schemas(model: ModelData, name: string, resolve: RefResolver): Record<string, JsonSchema> {
        const { metadata, constraints, indexes } = model;
        const properties = Object.fromEntries(model.fields.map(field => [field.name, fieldSchema(field, resolve)]));
        const required = model.fields.filter(field => field.constraints?.nullable === false).map(field => field.name);
        const xModel: Record<string, unknown> = { name: metadata.name };
        if (metadata.version !== undefined) xModel.version = metadata.version;
        if (metadata.schema !== undefined) xModel.schema = metadata.schema;
        if (constraints !== undefined) xModel.constraints = constraints;
        if (indexes !== undefined) xModel.indexes = indexes;

        // What clients send: no values the database generates, and none of the model's metadata
        const writable = model.fields.filter(field => field.constraints?.identity !== 'always');
        const input = Object.fromEntries(writable.map(field => {
            const schema = withoutExtensions(properties[field.name]);
            delete schema.readOnly;
            return [field.name, schema];
        }));
        const inputRequired = writable
            .filter(field => {
                const c = field.constraints ?? {};
                return c.nullable === false && c.default === undefined && c.identity === undefined;
            })
            .map(field => field.name);

        return {
            [name]: {
                type: 'object',
                ...(metadata.description !== undefined ? { description: metadata.description } : {}),
                properties,
                ...(required.length > 0 ? { required } : {}),
                'x-model': xModel,
            },
            [`${name}Input`]: {
                type: 'object',
                description: `${name} to create, or to replace an existing one with`,
                properties: input,
                ...(inputRequired.length > 0 ? { required: inputRequired } : {}),
            },
            [`${name}Patch`]: {
                type: 'object',
                description: `Fields of a ${name} to change; the others keep their values`,
                properties: input,
                minProperties: 1,
            },
            [`${name}List`]: {
                type: 'object',
                description: `A page of ${name} records`,
                properties: {
                    items: { type: 'array', items: schemaRef(name) },
                    total: { type: 'integer', format: 'int64', minimum: 0, description: 'Number of records on all pages' },
                },
                required: ['items', 'total'],
            },
        };
    }

    private paths(model: ModelData, name: string, resolve: RefResolver): Record<string, Record<string, any>> {
        const operations = new Set(this.options.operations ?? CRUD_OPERATIONS);
        const collection = this.options.paths?.[model.metadata.name] ?? collectionPath(model.metadata.name);
        const keys = keyFields(model);
        const names = plural(name);
        const tags = [name];
        const body = (schema: string) => ({ required: true, content: json(schemaRef(schema)) });
        const record = (description: string) => ({ description, content: json(schemaRef(name)) });

        const paths: Record<string, Record<string, any>> = {};
        const collectionOperations: Record<string, any> = {};
        if (operations.has('list'))
            collectionOperations.get = {
                operationId: `list${names}`, summary: `List ${names}`, tags,
                parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }],
                responses: { 200: { description: `A page of ${names}`, content: json(schemaRef(`${name}List`)) }, 400: problem('BadRequest') },
            };
        if (operations.has('create'))
            collectionOperations.post = {
                operationId: `create${name}`, summary: `Create a ${name}`, tags, requestBody: body(`${name}Input`),
                responses: { 201: record(`The created ${name}`), 400: problem('BadRequest'), 409: problem('Conflict') },
            };
        if (Object.keys(collectionOperations).length > 0) paths[collection] = collectionOperations;
        if (keys.length === 0) return paths;

        const itemOperations: Record<string, any> = {
            parameters: keys.map(field => ({
                name: field.name, in: 'path', required: true, schema: parameterSchema(field, resolve),
                ...(field.description !== undefined ? { description: field.description } : {}),
            })),
        };
        if (operations.has('read'))
            itemOperations.get = {
                operationId: `get${name}`, summary: `Get a ${name}`, tags,
                responses: { 200: record(`The ${name}`), 404: problem('NotFound') },
            };
        if (operations.has('replace'))
            itemOperations.put = {
                operationId: `replace${name}`, summary: `Replace a ${name}`, tags, requestBody: body(`${name}Input`),
                responses: { 200: record(`The ${name} as replaced`), 400: problem('BadRequest'), 404: problem('NotFound'), 409: problem('Conflict') },
            };
        if (operations.has('update'))
            itemOperations.patch = {
                operationId: `update${name}`, summary: `Change fields of a ${name}`, tags, requestBody: body(`${name}Patch`),
                responses: { 200: record(`The ${name} as changed`), 400: problem('BadRequest'), 404: problem('NotFound'), 409: problem('Conflict') },
            };
        if (operations.has('delete'))
            itemOperations.delete = {
                operationId: `delete${name}`, summary: `Delete a ${name}`, tags,
                responses: { 204: { description: `The ${name} is deleted` }, 404: problem('NotFound') },
            };
        if (Object.keys(itemOperations).length > 1)
            paths[collection + keys.map(field => `/{${field.name}}`).join('')] = itemOperations;
        return paths;
    }

    private pageParameters(): Record<string, any> {
        const maxPageSize = this.options.maxPageSize ?? 100;
        return {
            Limit: {
                name: 'limit', in: 'query', description: 'Number of records on the page',
                schema: { type: 'integer', minimum: 1, maximum: maxPageSize, default: this.options.defaultPageSize ?? 20 },
            },
            Offset: {
                name: 'offset', in: 'query', description: 'Number of records to skip',
                schema: { type: 'integer', minimum: 0, default: 0 },
            },
        };
    }

    private errorResponses(): Record<string, any> {
        return Object.fromEntries(Object.entries(ERROR_RESPONSES).map(([name, description]) =>
            [name, { description, content: { [PROBLEM_CONTENT]: { schema: schemaRef('Problem') } } }]));
    }

    private readModel(name: string, schema: JsonSchema, modelName: (ref: string) => string): ModelData {
        const xModel = schema['x-model'] ?? {};
        const required = new Set<string>(schema.required ?? []);
        const metadata: ModelData['metadata'] = { name: xModel.name ?? name };
        if (xModel.version !== undefined) metadata.version = xModel.version;
        if (xModel.schema !== undefined) metadata.schema = xModel.schema;
        if (schema.description !== undefined) metadata.description = schema.description;
        const model: ModelData = {
            metadata,
            fields: Object.entries(schema.properties ?? {})
                .map(([field, property]) => readField(field, property as JsonSchema, required.has(field), modelName)),
        };
        if (xModel.constraints !== undefined) model.constraints = xModel.constraints;
        if (xModel.indexes !== undefined) model.indexes = xModel.indexes;
        return model;
    }
}
