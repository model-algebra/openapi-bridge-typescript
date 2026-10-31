import { Model, ModelSet } from 'model-algebra-common';
import { OpenApiBridge } from './OpenApiBridge';
import { OpenApiSetBridge } from './OpenApiSetBridge';
import { eventsJson, models, openApiErrors, readExample, shopJson } from './test/models';

const bridge = new OpenApiSetBridge();
const events = () => bridge.toTarget(models(eventsJson));

describe('the document', () => {
    it.each([
        ['shop database', shopJson],
        ['events', eventsJson],
        ['all types', [readExample('all_types_model.json')]],
        ['user core', [readExample('user_core_add_extended.json')]],
    ])('of %s is valid OpenAPI 3.1', async (_, json) => {
        const document = bridge.toTarget(models(json));
        expect(document.openapi).toBe('3.1.0');
        expect(await openApiErrors(document)).toEqual([]);
    });

    it('has collection and item paths for every model, item paths by the primary key', () => {
        expect(Object.keys(events().paths)).toEqual([
            '/venues', '/venues/{id}',
            '/addresses',
            '/events', '/events/{id}',
            '/tickets', '/tickets/{eventId}/{seat}',
            '/log-entries',
        ]);
    });

    it('describes the CRUD operations', () => {
        const paths = events().paths;
        const ids = (path: string) => Object.entries(paths[path]).filter(([method]) => method !== 'parameters')
            .map(([method, operation]) => `${method} ${operation.operationId}`);
        expect(ids('/events')).toEqual(['get listEvents', 'post createEvent']);
        expect(ids('/events/{id}')).toEqual(['get getEvent', 'put replaceEvent', 'patch updateEvent', 'delete deleteEvent']);
        expect(ids('/log-entries')).toEqual(['get listLogEntries', 'post createLogEntry']);

        const list = paths['/events'].get;
        expect(list.parameters).toEqual([{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }]);
        expect(list.responses[200].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/EventList' });
        expect(paths['/events'].post.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/EventInput' });
        expect(paths['/events'].post.responses[201].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Event' });
        expect(paths['/events/{id}'].patch.requestBody.content).toEqual({ 'application/merge-patch+json': { schema: { $ref: '#/components/schemas/EventPatch' } } });
        expect(paths['/events/{id}'].patch.description).toContain('JSON Merge Patch (RFC 7396)');
        expect(paths['/events/{id}'].delete.responses).toEqual({
            204: { description: 'The Event is deleted' },
            404: { $ref: '#/components/responses/NotFound' },
            default: { $ref: '#/components/responses/Error' },
        });
        expect(list.tags).toEqual(['Event']);
    });

    it('gives the location of created records', () => {
        const document = events();
        expect(document.paths['/events'].post.responses[201].headers).toEqual({ Location: { $ref: '#/components/headers/Location' } });
        expect(document.components!.headers!.Location).toEqual({ description: 'URL of the created record', schema: { type: 'string', format: 'uri-reference' } });
    });

    it('tells malformed requests from invalid records, and has a response for unexpected errors', () => {
        const responses = (path: string, method: string) => Object.keys(events().paths[path][method].responses);
        expect(responses('/events', 'post')).toEqual(['201', '400', '409', '415', '422', 'default']);
        expect(responses('/events/{id}', 'put')).toEqual(['200', '400', '404', '409', '415', '422', 'default']);
        expect(responses('/events/{id}', 'patch')).toEqual(['200', '400', '404', '409', '415', '422', 'default']);
        expect(responses('/events', 'get')).toEqual(['200', '400', 'default']);
        expect(responses('/events/{id}', 'get')).toEqual(['200', '404', 'default']);
        expect(Object.keys(events().components!.responses!)).toEqual(['BadRequest', 'NotFound', 'Conflict', 'UnsupportedMediaType', 'UnprocessableContent', 'Error']);
    });

    it('takes path parameters from the key fields', () => {
        expect(events().paths['/tickets/{eventId}/{seat}'].parameters).toEqual([
            { name: 'eventId', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } },
            { name: 'seat', in: 'path', required: true, schema: { type: 'string', maxLength: 10 } },
        ]);
    });

    it('describes records as the API returns them, with the whole model', () => {
        const venue = events().components!.schemas!.Venue;
        expect(venue).toEqual({
            type: 'object',
            description: 'Places events happen at',
            properties: {
                id: { type: 'integer', format: 'int32', readOnly: true, 'x-identity': 'byDefault', 'x-primary-key': true },
                name: { description: 'Shown to visitors', type: 'string', maxLength: 100, 'x-unique': true },
                capacity: { type: ['integer', 'null'], format: 'int32', minimum: 1, maximum: 100000, default: 100 },
                address: { anyOf: [{ $ref: '#/components/schemas/Address' }, { type: 'null' }] },
                location: { not: { type: 'null' }, default: { lat: 0, lng: 0 } },
            },
            required: ['id', 'name', 'location'],
            'x-model': { name: 'Venue', version: '2.1.0', schema: 'events', indexes: [{ name: 'venue_name', fields: ['name'], unique: true }] },
        });
    });

    it('describes what clients send: no generated values, required only without a default', () => {
        const schemas = events().components!.schemas!;
        expect(Object.keys(schemas.EventInput.properties)).not.toContain('id');
        expect(schemas.EventInput.required).toEqual(['venueId', 'title', 'host']);
        expect(schemas.EventInput.properties.status).toEqual({ type: 'string', enum: ['DRAFT', 'PUBLISHED'], default: 'DRAFT' });
        // Identity by default: the client may give it
        expect(schemas.VenueInput.properties.id).toEqual({ type: 'integer', format: 'int32' });
        expect(schemas.VenueInput.required).toEqual(['name']);
        expect(schemas.EventPatch.required).toBeUndefined();
        expect(schemas.EventPatch.minProperties).toBe(1);
        expect(JSON.stringify(schemas.EventInput)).not.toContain('x-');
        expect(schemas.EventList.properties.items).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Event' } });
    });

    it('describes errors as problem details', () => {
        const components = events().components!;
        expect(components.responses!.NotFound).toEqual({
            description: 'There is no such record',
            content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
        });
        expect(Object.keys(components.schemas!.Problem.properties)).toEqual(['type', 'title', 'status', 'detail', 'instance']);
    });

    it('describes references to models outside the document by name', () => {
        const document = new OpenApiBridge().toTarget(new Model(structuredClone(eventsJson[0])));
        expect(document.components!.schemas!.Venue.properties.address).toEqual({ type: ['object', 'null'], 'x-ref': 'Address' });
    });
});

describe('options', () => {
    it('set the title, version, description and servers', () => {
        const document = new OpenApiSetBridge({
            title: 'Events API', version: '3.0.0', description: 'Everything about events',
            servers: [{ url: 'https://api.example.com/v3' }],
        }).toTarget(models(eventsJson));
        expect(document.info).toEqual({ title: 'Events API', version: '3.0.0', description: 'Everything about events' });
        expect(document.servers).toEqual([{ url: 'https://api.example.com/v3' }]);
        expect(bridge.toTarget(models(eventsJson)).info).toEqual({ title: 'API', version: '1.0.0' });
        expect(new OpenApiBridge().toTarget(new Model(structuredClone(eventsJson[0]))).info).toEqual({ title: 'Venue API', version: '2.1.0' });
    });

    it('choose the operations', () => {
        const paths = new OpenApiSetBridge({ operations: ['list', 'read'] }).toTarget(models(eventsJson)).paths;
        expect(Object.keys(paths['/events'])).toEqual(['get']);
        expect(Object.keys(paths['/events/{id}'])).toEqual(['parameters', 'get']);
        const createOnly = new OpenApiSetBridge({ operations: ['create'] }).toTarget(models(eventsJson)).paths;
        expect(Object.keys(createOnly)).not.toContain('/events/{id}');
    });

    it('add ETags and If-Match for optimistic locking', async () => {
        const document = new OpenApiSetBridge({ etags: true }).toTarget(models(eventsJson));
        const item = document.paths['/events/{id}'];
        const etag = { ETag: { $ref: '#/components/headers/ETag' } };
        expect(item.get.responses[200].headers).toEqual(etag);
        expect(document.paths['/events'].post.responses[201].headers).toEqual({ Location: { $ref: '#/components/headers/Location' }, ...etag });
        for (const method of ['put', 'patch', 'delete']) {
            expect(item[method].parameters).toEqual([{ $ref: '#/components/parameters/IfMatch' }]);
            expect(item[method].responses[412]).toEqual({ $ref: '#/components/responses/PreconditionFailed' });
        }
        expect(document.components!.parameters!.IfMatch).toMatchObject({ name: 'If-Match', in: 'header' });
        expect(await openApiErrors(document)).toEqual([]);
        // Without the option
        expect(events().paths['/events/{id}'].put.parameters).toBeUndefined();
        expect(events().components!.headers!.ETag).toBeUndefined();
    });

    it('add links to pages', async () => {
        const document = new OpenApiSetBridge({ pageLinks: true }).toTarget(models(eventsJson));
        const list = document.components!.schemas!.EventList;
        expect(list.properties.links).toEqual({ $ref: '#/components/schemas/PageLinks' });
        expect(list.required).toEqual(['items', 'total', 'links']);
        expect(Object.keys(document.components!.schemas!.PageLinks.properties)).toEqual(['self', 'first', 'prev', 'next', 'last']);
        expect(await openApiErrors(document)).toEqual([]);
        expect(events().components!.schemas!.PageLinks).toBeUndefined();
    });

    it('set collection paths and page sizes', () => {
        const document = new OpenApiSetBridge({ paths: { Venue: '/places' }, defaultPageSize: 50, maxPageSize: 500 }).toTarget(models(eventsJson));
        expect(Object.keys(document.paths).slice(0, 2)).toEqual(['/places', '/places/{id}']);
        expect(document.components!.parameters!.Limit.schema).toEqual({ type: 'integer', minimum: 1, maximum: 500, default: 50 });
    });
});

describe('errors', () => {
    it('reject models that would have the same schema name', () => {
        expect(() => bridge.toTarget(models([{ metadata: { name: 'Log entry' }, fields: [] }, { metadata: { name: 'LogEntry' }, fields: [] }])))
            .toThrow('Models Log entry and LogEntry would both be described by schema LogEntry');
    });

    it('reject primary keys of unknown fields', () => {
        expect(() => bridge.toTarget(models([{ metadata: { name: 'A' }, fields: [], constraints: [{ name: 'k', type: 'primaryKey', fields: ['x'] }] }])))
            .toThrow('Primary key of A names unknown field x');
    });

    it.each([
        ['unknown types', { type: 'MONEY' }, 'Unsupported type MONEY of field v'],
        ['ENUM without values', { type: 'ENUM' }, 'ENUM field v requires parameters.values'],
        ['OBJECT without a model', { type: 'OBJECT' }, 'OBJECT field v requires parameters.ref'],
        ['UNION without options', { type: 'UNION', parameters: { oneOf: [] } }, 'UNION field v requires parameters.oneOf'],
    ])('reject %s', (_, field, message) => {
        expect(() => bridge.toTarget(new ModelSet([new Model({ metadata: { name: 'A' }, fields: [{ name: 'v', ...field }] })]))).toThrow(message);
    });

    it('reject model names that make no schema name', () => {
        expect(() => bridge.toTarget(models([{ metadata: { name: '1st' }, fields: [] }]))).toThrow('cannot be turned into a schema name');
    });
});
