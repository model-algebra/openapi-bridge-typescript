import { Model, ModelSet } from 'model-algebra-common';
import { toModelData } from 'model-algebra-typescript';
import { OpenApiBridge } from './OpenApiBridge';
import { OpenApiSetBridge } from './OpenApiSetBridge';
import { openApiErrors, readExample } from './test/models';

const person = () => readExample('person_search_model.json');
const listParameters = (json: any, path = '/persons') =>
    new OpenApiBridge().toTarget(new Model(json)).paths[path].get.parameters.slice(2);
const item = (fields: any[], extra: Record<string, unknown> = {}) => ({ metadata: { name: 'Item', version: '1.0.0' }, fields, ...extra });

describe('query parameters of list operations', () => {
    it('come from the sortable and filterable fields and the sort orders and filters of the model', () => {
        expect(listParameters(person()).map((p: any) => [p.name, p.schema])).toEqual([
            ['sort', { type: 'array', items: { type: 'string', enum: [
                'lastName.plain', '-lastName.plain', 'lastName.caseless', '-lastName.caseless', 'firstName', '-firstName',
                '-age', 'registeredAt', '-registeredAt', 'byName', 'newest', 'relevance',
            ] } }],
            ['lastName.equals', { type: 'string', maxLength: 100 }],
            ['lastName.prefix', { type: 'string', maxLength: 100 }],
            ['lastName.similar', { type: 'string' }],
            ['firstName', { type: 'string', maxLength: 100 }],
            ['age.gte', { type: 'integer', format: 'int16', minimum: 0 }],
            ['age.lte', { type: 'integer', format: 'int16', minimum: 0 }],
            ['status.any', { type: 'string', enum: ['ACTIVE', 'BLOCKED'] }],
            ['status.active', { type: 'boolean' }],
            ['email', { type: 'boolean' }],
            ['registeredAt.after', { type: 'string', format: 'date-time' }],
            ['registeredAt.sinceBirth', { type: 'boolean' }],
            ['adults', { type: 'boolean' }],
            ['verified', { type: 'boolean' }],
            ['nearby', { type: 'number', format: 'double' }],
        ]);
    });

    it('explain what each parameter does', () => {
        const parameters = Object.fromEntries(listParameters(person()).map((p: any) => [p.name, p]));
        expect(parameters.sort).toMatchObject({ in: 'query', style: 'form', explode: false });
        expect(parameters.sort.description).toContain('lastName.caseless: by lower(lastName, row)');
        expect(parameters.sort.description).toContain('age: by age, desc only');
        expect(parameters.sort.description).toContain('byName: by lastName, firstName');
        expect(parameters.sort.description).toContain('relevance: by relevanceOf(row) desc');
        expect(parameters['lastName.prefix'].description).toBe('Only records where startsWith(lastName, row, value) is true');
        expect(parameters.firstName.description).toBe('Only records where lower(firstName, row) = the value');
        expect(parameters['status.active'].description).toBe('With true, only records where status = "ACTIVE"');
        expect(parameters['registeredAt.sinceBirth'].description).toBe('With true, only records where registeredAt >= bornAt');
        expect(parameters.email.description).toBe('With true, only records where isBlank(email, row) is true');
        expect(parameters.adults.description).toBe('With true, only records where age >= 18');
        expect(parameters.nearby.description).toBe('Only records where isWithinKm(row, value) is true');
    });

    it('take true as the default definition', () => {
        const parameters = listParameters(item([{ name: 'code', type: 'TEXT', sortable: true, filterable: true }]), '/items');
        expect(parameters.map((p: any) => p.name)).toEqual(['sort', 'code']);
        expect(parameters[0].schema.items.enum).toEqual(['code', '-code']);
        expect(parameters[1].description).toBe('Only records where code = the value');
    });

    it('sort in one direction only when the definition says so', () => {
        const parameters = listParameters(item([{ name: 'at', type: 'DATE', sortable: { direction: 'asc' } }]), '/items');
        expect(parameters[0].schema.items.enum).toEqual(['at']);
    });

    it('are left out when records can be neither sorted nor filtered', () => {
        expect(listParameters(item([{ name: 'code', type: 'TEXT' }]), '/items')).toEqual([]);
    });

    it('make a valid document', async () => {
        expect(await openApiErrors(new OpenApiBridge().toTarget(new Model(person())))).toEqual([]);
    });

    it('come back with the model', () => {
        const model = new Model(person());
        const bridge = new OpenApiBridge();
        expect(toModelData(bridge.toModel(bridge.toTarget(model)))).toEqual(toModelData(model));
        const set = new OpenApiSetBridge();
        const document = set.toTarget(new ModelSet([model]));
        expect(set.toTarget(set.toModel(document))).toEqual(document);
    });
});

describe('query parameter errors', () => {
    const fail = (json: any) => () => new OpenApiBridge().toTarget(new Model(json));

    it.each([
        ['a filter named like the paging parameters', item([{ name: 'limit', type: 'INT32', filterable: true }]), 'Query parameter limit of model Item is defined twice'],
        ['a filter of the model named like a field filter', item([{ name: 'code', type: 'TEXT', filterable: true }], { filters: { code: { predicate: 'x' } } }), 'Query parameter code of model Item is defined twice'],
        ['a filter named sort', item([{ name: 'a', type: 'TEXT' }], { filters: { sort: { predicate: 'x' } } }), 'Query parameter sort of model Item is defined twice'],
        ['a sort order named like a sort key', item([{ name: 'code', type: 'TEXT', sortable: true }], { sortings: { code: [{ field: 'code' }] } }), 'Sort key code of model Item is defined twice'],
        ['sort orders of unknown fields', item([], { sortings: { byX: [{ field: 'x' }] } }), 'Sort order byX of model Item names unknown field x'],
        ['filters of unknown fields', item([], { filters: { f: { field: 'x', op: '=', value: 1 } } }), 'Filter f of model Item names unknown field x'],
        ['filters comparing with unknown fields', item([{ name: 'a', type: 'INT32' }], { filters: { f: { field: 'a', op: '<', otherField: 'x' } } }), 'Filter f of model Item names unknown field x'],
        ['field filters comparing with unknown fields', item([{ name: 'a', type: 'INT32', filterable: { op: '<', otherField: 'x' } }]), 'Filter a of model Item names unknown field x'],
        ['arguments of unknown types', item([{ name: 'a', type: 'TEXT', filterable: { predicate: 'p', argument: { type: 'MONEY' } } }]), 'Unsupported type MONEY of argument of filter a'],
    ])('reject %s', (_, json, message) => {
        expect(fail(json)).toThrow(message);
    });
});
