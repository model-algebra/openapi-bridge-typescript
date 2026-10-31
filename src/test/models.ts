import * as fs from 'node:fs';
import { Model, ModelSet } from 'model-algebra-common';
import { Validator } from '@seriousme/openapi-schema-validator';

export const readExample = (name: string) => JSON.parse(fs.readFileSync(`src/examples/${name}`, 'utf-8'));

/** Models of src/examples/shop_database. */
export const shopJson = ['user', 'delivery_type', 'discount', 'product', 'order'].map(name => readExample(`shop_database/${name}.json`));

/** Models using every feature: references between models, composite keys, identity, defaults, table constraints... */
export const eventsJson: any[] = [
    {
        metadata: { name: 'Venue', version: '2.1.0', schema: 'events', description: 'Places events happen at' },
        fields: [
            { name: 'id', type: 'INT32', constraints: { primaryKey: true, identity: 'byDefault', nullable: false } },
            { name: 'name', type: 'STRING', description: 'Shown to visitors', parameters: { length: 100 }, constraints: { nullable: false, unique: true } },
            { name: 'capacity', type: 'INT32', constraints: { min: 1, max: 100000, default: { value: 100 } } },
            { name: 'address', type: 'OBJECT', parameters: { ref: 'Address' } },
            { name: 'location', type: 'JSON', constraints: { nullable: false, default: { value: { lat: 0, lng: 0 } } } },
        ],
        indexes: [{ name: 'venue_name', fields: ['name'], unique: true }],
    },
    {
        metadata: { name: 'Address', version: '1.0.0' },
        fields: [
            { name: 'city', type: 'STRING', parameters: { length: 50 }, constraints: { nullable: false } },
            { name: 'street', type: 'TEXT' },
        ],
    },
    {
        metadata: { name: 'Event', version: '1.0.0', schema: 'events' },
        fields: [
            { name: 'id', type: 'INT64', constraints: { primaryKey: true, identity: 'always', nullable: false } },
            { name: 'venueId', type: 'INT32', constraints: { nullable: false, foreignKey: { ref: 'Venue', field: 'id', onDelete: 'cascade' } } },
            { name: 'title', type: 'STRING', parameters: { length: 200 }, constraints: { nullable: false } },
            { name: 'code', type: 'STRING', parameters: { length: 3 }, constraints: { regex: '^[A-Z]{3}$' } },
            { name: 'status', type: 'ENUM', parameters: { values: ['DRAFT', 'PUBLISHED'] }, targets: { postgresql: { enumType: 'event_status' } }, constraints: { nullable: false, default: { value: 'DRAFT' } } },
            { name: 'price', type: 'DECIMAL', parameters: { precision: 8, scale: 2 }, constraints: { min: 0, default: { value: 0 } } },
            { name: 'startsAt', type: 'TIMESTAMP_TZ', parameters: { precision: 3 }, constraints: { default: { function: 'now' } } },
            { name: 'endsAt', type: 'TIMESTAMP_TZ' },
            { name: 'doors', type: 'TIME' },
            { name: 'day', type: 'DATE' },
            { name: 'token', type: 'UUID', constraints: { default: { function: 'uuid' }, unique: true } },
            { name: 'tags', type: 'ARRAY', parameters: { items: { type: 'STRING', parameters: { length: 20 } } } },
            { name: 'flags', type: 'ARRAY', parameters: { items: { type: 'ENUM', parameters: { values: ['a', 'b'] } } } },
            { name: 'prize', type: 'UNION', parameters: { oneOf: [{ type: 'TEXT' }, { type: 'INT32' }] } },
            { name: 'host', type: 'OBJECT', parameters: { ref: 'Address' }, constraints: { nullable: false } },
            { name: 'online', type: 'BOOLEAN', constraints: { nullable: false, default: { value: false } } },
            { name: 'rating', type: 'FLOAT64', constraints: { min: -1.5, max: 5 } },
            { name: 'small', type: 'INT16' },
            { name: 'real', type: 'FLOAT32' },
            { name: 'data', type: 'BYTES' },
            { name: 'duration', type: 'DURATION' },
            { name: 'notes', type: 'TEXT', description: "Organizer's notes", constraints: { required: true } },
        ],
        constraints: [
            { name: 'event_dates', type: 'check', rule: { field: 'endsAt', op: '>=', otherField: 'startsAt' } },
            { name: 'event_venue_title', type: 'unique', fields: ['venueId', 'title'] },
        ],
        indexes: [{ name: 'event_starts', fields: ['startsAt'] }],
    },
    {
        metadata: { name: 'Ticket', version: '1.0.0' },
        fields: [
            { name: 'eventId', type: 'INT64', constraints: { nullable: false, foreignKey: { ref: 'Event', field: 'id' } } },
            { name: 'seat', type: 'STRING', parameters: { length: 10 }, constraints: { nullable: false } },
            { name: 'holder', type: 'TEXT' },
        ],
        constraints: [{ name: 'ticket_key', type: 'primaryKey', fields: ['eventId', 'seat'] }],
    },
    {
        metadata: { name: 'Log entry', version: '1.0.0' },
        fields: [{ name: 'message', type: 'TEXT', constraints: { nullable: false } }],
    },
];

export const models = (json: any[]) => new ModelSet(json.map(model => new Model(structuredClone(model))));

const validator = new Validator();

/** Errors of the document against the OpenAPI 3.1 schema; empty when it is valid. */
export async function openApiErrors(document: unknown): Promise<unknown> {
    const result = await validator.validate(document as any);
    return result.valid ? [] : result.errors;
}
