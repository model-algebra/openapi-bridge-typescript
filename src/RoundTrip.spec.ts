import { Model } from 'model-algebra-common';
import { toModelData, type ModelData } from 'model-algebra-typescript';
import { OpenApiBridge } from './OpenApiBridge';
import { OpenApiSetBridge } from './OpenApiSetBridge';
import { eventsJson, models, openApiErrors, readExample, shopJson } from './test/models';

/*
 * Model -> OpenAPI -> model. Models in canonical form come back exactly; other models come back in canonical form,
 * and documents written from read models are the same documents.
 */

const bridge = new OpenApiSetBridge();
const roundTrip = (json: any[]): ModelData[] => bridge.toModel(bridge.toTarget(models(json))).models.map(m => toModelData(m));
const data = (json: any[]): ModelData[] => json.map(model => toModelData(new Model(structuredClone(model))));
const item = (field: any) => [{ metadata: { name: 'Item', version: '1.0.0' }, fields: [{ name: 'value', ...field }] }];

describe('canonical models come back unchanged', () => {
    it.each<[string, any]>([
        ['INT16', { type: 'INT16' }],
        ['INT32', { type: 'INT32' }],
        ['INT64', { type: 'INT64' }],
        ['FLOAT32', { type: 'FLOAT32' }],
        ['FLOAT64', { type: 'FLOAT64' }],
        ['DECIMAL', { type: 'DECIMAL' }],
        ['DECIMAL with precision and scale', { type: 'DECIMAL', parameters: { precision: 10, scale: 2 } }],
        ['STRING with length', { type: 'STRING', parameters: { length: 20 } }],
        ['TEXT', { type: 'TEXT' }],
        ['BOOLEAN', { type: 'BOOLEAN' }],
        ['BYTES', { type: 'BYTES' }],
        ['UUID', { type: 'UUID' }],
        ['DATE', { type: 'DATE' }],
        ['TIME', { type: 'TIME' }],
        ['TIME with precision', { type: 'TIME', parameters: { precision: 3 } }],
        ['TIMESTAMP', { type: 'TIMESTAMP', parameters: { precision: 0 } }],
        ['TIMESTAMP_TZ', { type: 'TIMESTAMP_TZ' }],
        ['DURATION', { type: 'DURATION', parameters: { precision: 6 } }],
        ['JSON', { type: 'JSON' }],
        ['JSON that is not null', { type: 'JSON', description: 'Settings', constraints: { nullable: false } }],
        ['ENUM', { type: 'ENUM', parameters: { values: ['A', "B'C"] } }],
        ['native enum type', { type: 'ENUM', parameters: { values: ['A', 'B'] }, targets: { postgresql: { enumType: 'kind' } } }],
        ['OBJECT', { type: 'OBJECT', parameters: { ref: 'Address' } }],
        ['UNION', { type: 'UNION', parameters: { oneOf: [{ type: 'TEXT' }, { type: 'INT32' }, { type: 'OBJECT', parameters: { ref: 'Address' } }] } }],
        ['UNION that is not null', { type: 'UNION', parameters: { oneOf: [{ type: 'BOOLEAN' }, { type: 'DATE' }] }, constraints: { nullable: false } }],
        ['ARRAY of INT32', { type: 'ARRAY', parameters: { items: { type: 'INT32' } } }],
        ['ARRAY of STRING with length', { type: 'ARRAY', parameters: { items: { type: 'STRING', parameters: { length: 5 } } } }],
        ['ARRAY of ENUM', { type: 'ARRAY', parameters: { items: { type: 'ENUM', parameters: { values: ['x', 'y'] } } } }],
        ['ARRAY of OBJECT', { type: 'ARRAY', parameters: { items: { type: 'OBJECT', parameters: { ref: 'Address' } } }, constraints: { nullable: false } }],
        ['ARRAY of arrays', { type: 'ARRAY', parameters: { items: { type: 'ARRAY', parameters: { items: { type: 'FLOAT64' } } } } }],
        ['type override', { type: 'TEXT', targets: { postgresql: { type: 'inet' } } }],
        ['not null', { type: 'TEXT', constraints: { nullable: false } }],
        ['primary key', { type: 'INT64', constraints: { primaryKey: true, nullable: false } }],
        ['unique', { type: 'UUID', constraints: { unique: true } }],
        ['identity', { type: 'INT64', constraints: { identity: 'always', nullable: false } }],
        ['identity by default', { type: 'INT16', constraints: { identity: 'byDefault' } }],
        ['default values', { type: 'INT32', constraints: { default: { value: -7 } } }],
        ['null default', { type: 'TEXT', constraints: { default: { value: null } } }],
        ['JSON default', { type: 'JSON', constraints: { default: { value: { a: [1, 'x'] } } } }],
        ['default functions', { type: 'TIMESTAMP_TZ', constraints: { default: { function: 'now' } } }],
        ['min and max', { type: 'DECIMAL', parameters: { precision: 8, scale: 2 }, constraints: { min: 0.01, max: 999.99 } }],
        ['regex', { type: 'TEXT', constraints: { regex: "^[a-z]+\\d*'?$" } }],
        ['allowed values of a STRING', { type: 'STRING', parameters: { length: 10 }, constraints: { enum: ['a', 'b'] } }],
        ['allowed values of an ARRAY of STRING', { type: 'ARRAY', parameters: { items: { type: 'STRING', parameters: { length: 3 } } }, constraints: { enum: ['abc'] } }],
        ['foreign key', { type: 'INT64', constraints: { foreignKey: { ref: 'Item', field: 'value', onDelete: 'setNull', onUpdate: 'cascade' } } }],
        ['required by applications', { type: 'TEXT', constraints: { required: true } }],
        ['description', { type: 'TEXT', description: "Shown as it's typed" }],
    ])('%s', (_, field) => {
        expect(roundTrip(item(field))).toEqual(data(item(field)));
    });

    it('models with metadata, table constraints and indexes, and models referencing each other', () => {
        const json = eventsJson.map(model => ({ ...model, fields: model.fields.map((f: any) => ({ ...f })) }));
        // Venue.capacity and others are canonical; Event.notes is nullable by default, so canonical too
        expect(roundTrip(json)).toEqual(data(json));
    });

    it('a single model with OpenApiBridge', () => {
        const single = new OpenApiBridge();
        const venue = new Model(structuredClone(eventsJson[0]));
        expect(toModelData(single.toModel(single.toTarget(venue)))).toEqual(toModelData(venue));
    });
});

describe('other models come back in canonical form', () => {
    it.each<[string, any, any]>([
        ['legacy integer', { type: 'integer' }, { type: 'INT32' }],
        ['legacy number', { type: 'number' }, { type: 'DECIMAL' }],
        ['legacy string', { type: 'string' }, { type: 'TEXT' }],
        ['STRING without length', { type: 'STRING' }, { type: 'TEXT' }],
        ['legacy boolean', { type: 'boolean' }, { type: 'BOOLEAN' }],
        ['legacy date', { type: 'date' }, { type: 'DATE' }],
        ['legacy object', { type: 'object' }, { type: 'JSON' }],
        ['legacy array', { type: 'array' }, { type: 'ARRAY', parameters: { items: { type: 'JSON' } } }],
        ['DATETIME', { type: 'DATETIME' }, { type: 'TIMESTAMP' }],
        ['TEXT with allowed values', { type: 'TEXT', constraints: { enum: ['A', 'B'] } }, { type: 'ENUM', parameters: { values: ['A', 'B'] } }],
        ['ARRAY of TEXT with allowed values', { type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, constraints: { enum: ['x'] } },
            { type: 'ARRAY', parameters: { items: { type: 'ENUM', parameters: { values: ['x'] } } } }],
        ['explicitly nullable', { type: 'TEXT', constraints: { nullable: true } }, { type: 'TEXT' }],
        ['legacy foreign_key', { type: 'INT32', constraints: { foreign_key: { ref: 'Item', field: 'id' } } }, { type: 'INT32', constraints: { foreignKey: { ref: 'Item', field: 'id' } } }],
    ])('%s', (_, field, canonical) => {
        expect(roundTrip(item(field))[0].fields[0]).toEqual({ name: 'value', ...canonical });
    });

    it('the shop database', () => {
        const read = roundTrip(shopJson);
        expect(read.map(m => m.metadata.name)).toEqual(['User', 'DeliveryType', 'Discount', 'Product', 'Order']);
        expect(roundTrip(read)).toEqual(read);
    });
});

describe('documents of read models', () => {
    it.each([
        ['events', eventsJson],
        ['shop database', shopJson],
        ['all types', [readExample('all_types_model.json')]],
    ])('of %s are the same documents', async (_, json) => {
        const document = bridge.toTarget(models(json));
        expect(bridge.toTarget(bridge.toModel(document))).toEqual(document);
        expect(await openApiErrors(document)).toEqual([]);
    });

    it('survive JSON', () => {
        const document = bridge.toTarget(models(eventsJson));
        expect(bridge.toModel(JSON.parse(JSON.stringify(document))).models.map(m => toModelData(m))).toEqual(data(eventsJson));
    });
});
