import { toModelData } from 'model-algebra-typescript';
import { OpenApiBridge } from './OpenApiBridge';
import { OpenApiSetBridge } from './OpenApiSetBridge';
import { collectionPath, componentName, plural } from './names';
import type { OpenApiDocument } from './openapi';

/** A document written by hand, without the extensions of this bridge. */
const petstore: OpenApiDocument = {
    openapi: '3.1.0',
    info: { title: 'Petstore', version: '1.0.0' },
    paths: {},
    components: {
        schemas: {
            Pet: {
                type: 'object',
                description: 'A pet for sale',
                required: ['id', 'name', 'nick'],
                properties: {
                    id: { type: 'integer', format: 'int64' },
                    name: { type: 'string', description: 'Name of the pet' },
                    nick: { type: ['string', 'null'], maxLength: 10 },
                    status: { type: 'string', enum: ['available', 'sold'] },
                    photoUrls: { type: 'array', items: { type: 'string' } },
                    category: { $ref: '#/components/schemas/Category' },
                    born: { type: 'string', format: 'date-time' },
                    weight: { type: 'number', minimum: 0 },
                    chip: { type: 'string', format: 'binary' },
                    meta: { type: 'object' },
                    either: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
                    numbers: { type: ['integer', 'string'] },
                    anything: {},
                },
            },
            Category: {
                type: 'object',
                properties: { id: { type: 'integer' }, name: { type: 'string', pattern: '^[a-z]+$' } },
            },
            Id: { type: 'string' },
        },
    },
};

describe('reading documents written by others', () => {
    it('reads every object schema as a model', () => {
        const read = new OpenApiSetBridge().toModel(petstore).models.map(m => toModelData(m));
        expect(read.map(m => m.metadata)).toEqual([{ name: 'Pet', description: 'A pet for sale' }, { name: 'Category' }]);
        expect(read[0].fields).toEqual([
            { name: 'id', type: 'INT64', constraints: { nullable: false } },
            { name: 'name', type: 'TEXT', description: 'Name of the pet', constraints: { nullable: false } },
            { name: 'nick', type: 'STRING', parameters: { length: 10 } },
            { name: 'status', type: 'ENUM', parameters: { values: ['available', 'sold'] } },
            { name: 'photoUrls', type: 'ARRAY', parameters: { items: { type: 'TEXT' } } },
            { name: 'category', type: 'OBJECT', parameters: { ref: 'Category' } },
            { name: 'born', type: 'TIMESTAMP_TZ' },
            { name: 'weight', type: 'FLOAT64', constraints: { min: 0 } },
            { name: 'chip', type: 'BYTES' },
            { name: 'meta', type: 'JSON' },
            { name: 'either', type: 'UNION', parameters: { oneOf: [{ type: 'TEXT' }, { type: 'INT32' }] } },
            { name: 'numbers', type: 'UNION', parameters: { oneOf: [{ type: 'INT32' }, { type: 'TEXT' }] } },
            { name: 'anything', type: 'JSON' },
        ]);
        expect(read[1].fields[1]).toEqual({ name: 'name', type: 'TEXT', constraints: { regex: '^[a-z]+$' } });
    });

    it('reads documents without schemas as no models', () => {
        expect(new OpenApiSetBridge().toModel({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: {} }).size).toBe(0);
    });

    it('rejects references to missing schemas', () => {
        const document = structuredClone(petstore);
        document.components!.schemas!.Pet.properties.category = { $ref: '#/components/schemas/Missing' };
        expect(() => new OpenApiSetBridge().toModel(document)).toThrow('Reference #/components/schemas/Missing points to no schema');
    });

    it('reads one model with OpenApiBridge, and refuses several', () => {
        const single = structuredClone(petstore);
        delete single.components!.schemas!.Category;
        delete single.components!.schemas!.Pet.properties.category;
        expect(new OpenApiBridge().toModel(single).metadata.name).toBe('Pet');
        expect(() => new OpenApiBridge().toModel(petstore)).toThrow('exactly one model, found 2');
    });
});

describe('names', () => {
    it.each([
        ['User', 'User', '/users'],
        ['UserProfile', 'UserProfile', '/user-profiles'],
        ['User db model', 'UserDbModel', '/user-db-models'],
        ['category', 'Category', '/categories'],
        ['Address', 'Address', '/addresses'],
        ['Box', 'Box', '/boxes'],
        ['Day', 'Day', '/days'],
        ['Batch', 'Batch', '/batches'],
        ['order_line', 'OrderLine', '/order-lines'],
        ['Line2Item', 'Line2Item', '/line2-items'],
    ])('model %s: schema %s, path %s', (model, component, path) => {
        expect(componentName(model)).toBe(component);
        expect(collectionPath(model)).toBe(path);
    });

    it('makes plurals', () => {
        expect(['user', 'city', 'key', 'bus', 'wish'].map(plural)).toEqual(['users', 'cities', 'keys', 'buses', 'wishes']);
    });
});
