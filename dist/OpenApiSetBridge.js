import { Model, ModelSet } from "model-algebra-common";
import { toModelData } from "model-algebra-typescript";
import { collectionPath, componentName, plural } from "./names.js";
import { OPENAPI_VERSION } from "./openapi.js";
import { fieldSchema, parameterSchema, readField, withoutExtensions } from "./schemas.js";
export const CRUD_OPERATIONS = ['list', 'create', 'read', 'replace', 'update', 'delete'];
const JSON_CONTENT = 'application/json';
const MERGE_PATCH_CONTENT = 'application/merge-patch+json';
const PROBLEM_CONTENT = 'application/problem+json';
/** RFC 9457 problem details, the body of error responses. */
const PROBLEM_SCHEMA = {
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
const ERROR_RESPONSES = {
    BadRequest: 'The request is malformed, e.g. the body is not valid JSON or a query parameter is not valid',
    NotFound: 'There is no such record',
    Conflict: 'The record conflicts with another one, e.g. a duplicate unique value',
    UnsupportedMediaType: 'The body is not in a media type the operation accepts',
    UnprocessableContent: 'The record is not valid: a value breaks a constraint of the model',
    Error: 'An unexpected error',
};
const PRECONDITION_FAILED = 'The record has changed since the version given in If-Match';
const PAGE_LINKS_SCHEMA = {
    type: 'object',
    description: 'Links to pages of the same list',
    properties: Object.fromEntries(['self', 'first', 'prev', 'next', 'last'].map(name => [name, { type: 'string', format: 'uri-reference' }])),
    required: ['self', 'first', 'last'],
};
const problem = (name) => ({ $ref: `#/components/responses/${name}` });
const schemaRef = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ [JSON_CONTENT]: { schema } });
/** Fields that identify a record: the primary key field, or the fields of the primaryKey table constraint. */
function keyFields(model) {
    const fields = model.fields.filter(field => field.constraints?.primaryKey === true);
    if (fields.length > 0)
        return fields;
    const constraint = model.constraints?.find(c => c.type === 'primaryKey');
    return (constraint?.fields ?? []).map(name => {
        const field = model.fields.find(f => f.name === name);
        if (field === undefined)
            throw new Error(`Primary key of ${model.metadata.name} names unknown field ${name}`);
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
export class OpenApiSetBridge {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    toTarget(models) {
        return this.document(models.models.map(model => toModelData(model)), this.options.title ?? 'API');
    }
    /**
     * Reads the models from the schemas of the document. Schemas written by toTarget() are recognized by their
     * x-model extension; in documents without any, every object schema becomes a model.
     */
    toModel(document) {
        const schemas = document.components?.schemas ?? {};
        const marked = Object.entries(schemas).filter(([, schema]) => schema['x-model'] !== undefined);
        const entries = marked.length > 0
            ? marked
            : Object.entries(schemas).filter(([, schema]) => schema.type === 'object' && schema.properties !== undefined);
        const modelName = (ref) => {
            const name = ref.replace(/^#\/components\/schemas\//, '');
            const schema = schemas[name];
            if (schema === undefined)
                throw new Error(`Reference ${ref} points to no schema`);
            return schema['x-model']?.name ?? name;
        };
        return new ModelSet(entries.map(([name, schema]) => new Model(this.readModel(name, schema, modelName))));
    }
    /** The document for the models; `title` when the options give none. */
    document(models, title) {
        const names = new Map();
        for (const model of models) {
            const component = componentName(model.metadata.name);
            const other = [...names].find(([, c]) => c === component);
            if (other !== undefined)
                throw new Error(`Models ${other[0]} and ${model.metadata.name} would both be described by schema ${component}`);
            names.set(model.metadata.name, component);
        }
        const resolve = name => names.get(name);
        const version = this.options.version ?? (models.length === 1 ? models[0].metadata.version : undefined) ?? '1.0.0';
        const document = {
            openapi: OPENAPI_VERSION,
            info: { title, version, ...(this.options.description !== undefined ? { description: this.options.description } : {}) },
            ...(this.options.servers !== undefined ? { servers: this.options.servers } : {}),
            tags: models.map(model => ({
                name: names.get(model.metadata.name),
                ...(model.metadata.description !== undefined ? { description: model.metadata.description } : {}),
            })),
            paths: {},
            components: { schemas: {}, parameters: this.parameters(), headers: this.headers(), responses: this.errorResponses() },
        };
        for (const model of models) {
            const component = names.get(model.metadata.name);
            Object.assign(document.components.schemas, this.schemas(model, component, resolve));
            Object.assign(document.paths, this.paths(model, component, resolve));
        }
        document.components.schemas.Problem = PROBLEM_SCHEMA;
        if (this.options.pageLinks === true)
            document.components.schemas.PageLinks = PAGE_LINKS_SCHEMA;
        return document;
    }
    schemas(model, name, resolve) {
        const { metadata, constraints, indexes } = model;
        const properties = Object.fromEntries(model.fields.map(field => [field.name, fieldSchema(field, resolve)]));
        const required = model.fields.filter(field => field.constraints?.nullable === false).map(field => field.name);
        const xModel = { name: metadata.name };
        if (metadata.version !== undefined)
            xModel.version = metadata.version;
        if (metadata.schema !== undefined)
            xModel.schema = metadata.schema;
        if (constraints !== undefined)
            xModel.constraints = constraints;
        if (indexes !== undefined)
            xModel.indexes = indexes;
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
                description: `Fields of a ${name} to change, as a JSON Merge Patch: null clears a field, fields not given keep their values`,
                properties: input,
                minProperties: 1,
            },
            [`${name}List`]: {
                type: 'object',
                description: `A page of ${name} records`,
                properties: {
                    items: { type: 'array', items: schemaRef(name) },
                    total: { type: 'integer', format: 'int64', minimum: 0, description: 'Number of records on all pages' },
                    ...(this.options.pageLinks === true ? { links: schemaRef('PageLinks') } : {}),
                },
                required: ['items', 'total', ...(this.options.pageLinks === true ? ['links'] : [])],
            },
        };
    }
    paths(model, name, resolve) {
        const operations = new Set(this.options.operations ?? CRUD_OPERATIONS);
        const etags = this.options.etags === true;
        const collection = this.options.paths?.[model.metadata.name] ?? collectionPath(model.metadata.name);
        const keys = keyFields(model);
        const names = plural(name);
        const tags = [name];
        const body = (schema, media = JSON_CONTENT) => ({ required: true, content: { [media]: { schema: schemaRef(schema) } } });
        // A response with a record; with its version when there are ETags
        const record = (description, headers = {}) => ({
            description,
            ...(etags || Object.keys(headers).length > 0 ? { headers: { ...headers, ...(etags ? { ETag: { $ref: '#/components/headers/ETag' } } : {}) } } : {}),
            content: json(schemaRef(name)),
        });
        // Responses of operations that write a record
        const writeErrors = {
            400: problem('BadRequest'), 409: problem('Conflict'), 415: problem('UnsupportedMediaType'), 422: problem('UnprocessableContent'),
        };
        const precondition = etags ? { 412: problem('PreconditionFailed') } : {};
        const ifMatch = etags ? [{ $ref: '#/components/parameters/IfMatch' }] : [];
        const unexpected = { default: problem('Error') };
        const paths = {};
        const collectionOperations = {};
        if (operations.has('list'))
            collectionOperations.get = {
                operationId: `list${names}`, summary: `List ${names}`, tags,
                parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }],
                responses: { 200: { description: `A page of ${names}`, content: json(schemaRef(`${name}List`)) }, 400: problem('BadRequest'), ...unexpected },
            };
        if (operations.has('create'))
            collectionOperations.post = {
                operationId: `create${name}`, summary: `Create a ${name}`, tags, requestBody: body(`${name}Input`),
                responses: { 201: record(`The created ${name}`, { Location: { $ref: '#/components/headers/Location' } }), ...writeErrors, ...unexpected },
            };
        if (Object.keys(collectionOperations).length > 0)
            paths[collection] = collectionOperations;
        if (keys.length === 0)
            return paths;
        const itemOperations = {
            parameters: keys.map(field => ({
                name: field.name, in: 'path', required: true, schema: parameterSchema(field, resolve),
                ...(field.description !== undefined ? { description: field.description } : {}),
            })),
        };
        if (operations.has('read'))
            itemOperations.get = {
                operationId: `get${name}`, summary: `Get a ${name}`, tags,
                responses: { 200: record(`The ${name}`), 404: problem('NotFound'), ...unexpected },
            };
        if (operations.has('replace'))
            itemOperations.put = {
                operationId: `replace${name}`, summary: `Replace a ${name}`, tags, requestBody: body(`${name}Input`),
                ...(etags ? { parameters: ifMatch } : {}),
                responses: { 200: record(`The ${name} as replaced`), ...writeErrors, 404: problem('NotFound'), ...precondition, ...unexpected },
            };
        if (operations.has('update'))
            itemOperations.patch = {
                operationId: `update${name}`, summary: `Change fields of a ${name}`, tags,
                description: 'JSON Merge Patch (RFC 7396): the fields given replace the ones of the record, null clears a field, the others keep their values.',
                requestBody: body(`${name}Patch`, MERGE_PATCH_CONTENT),
                ...(etags ? { parameters: ifMatch } : {}),
                responses: { 200: record(`The ${name} as changed`), ...writeErrors, 404: problem('NotFound'), ...precondition, ...unexpected },
            };
        if (operations.has('delete'))
            itemOperations.delete = {
                operationId: `delete${name}`, summary: `Delete a ${name}`, tags,
                ...(etags ? { parameters: ifMatch } : {}),
                responses: { 204: { description: `The ${name} is deleted` }, 404: problem('NotFound'), ...precondition, ...unexpected },
            };
        if (Object.keys(itemOperations).length > 1)
            paths[collection + keys.map(field => `/{${field.name}}`).join('')] = itemOperations;
        return paths;
    }
    parameters() {
        const maxPageSize = this.options.maxPageSize ?? 100;
        const ifMatch = {
            IfMatch: {
                name: 'If-Match', in: 'header',
                description: 'ETag of the version of the record the change is based on; the change fails with 412 if the record has changed since',
                schema: { type: 'string' },
            },
        };
        return {
            ...(this.options.etags === true ? ifMatch : {}),
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
    headers() {
        return {
            Location: { description: 'URL of the created record', schema: { type: 'string', format: 'uri-reference' } },
            ...(this.options.etags === true
                ? { ETag: { description: 'Version of the record, for If-Match', schema: { type: 'string' } } }
                : {}),
        };
    }
    errorResponses() {
        const responses = this.options.etags === true ? { ...ERROR_RESPONSES, PreconditionFailed: PRECONDITION_FAILED } : ERROR_RESPONSES;
        return Object.fromEntries(Object.entries(responses).map(([name, description]) => [name, { description, content: { [PROBLEM_CONTENT]: { schema: schemaRef('Problem') } } }]));
    }
    readModel(name, schema, modelName) {
        const xModel = schema['x-model'] ?? {};
        const required = new Set(schema.required ?? []);
        const metadata = { name: xModel.name ?? name };
        if (xModel.version !== undefined)
            metadata.version = xModel.version;
        if (xModel.schema !== undefined)
            metadata.schema = xModel.schema;
        if (schema.description !== undefined)
            metadata.description = schema.description;
        const model = {
            metadata,
            fields: Object.entries(schema.properties ?? {})
                .map(([field, property]) => readField(field, property, required.has(field), modelName)),
        };
        if (xModel.constraints !== undefined)
            model.constraints = xModel.constraints;
        if (xModel.indexes !== undefined)
            model.indexes = xModel.indexes;
        return model;
    }
}
//# sourceMappingURL=OpenApiSetBridge.js.map