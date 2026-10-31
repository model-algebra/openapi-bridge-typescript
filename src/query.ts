import { filterDefinitions, sortDefinitions, type FilterDefinition, type Op } from "model-algebra-common";
import type { FieldData, ModelData } from "model-algebra-typescript";
import type { JsonSchema } from "./openapi.js";
import { parameterSchema, typeSchema, type RefResolver } from "./schemas.js";

/*
 * Query parameters of list operations, from how the model says records can be sorted and filtered:
 *
 *   sort=lastName,-age,lastName.caseless,byName   sort keys in order; - sorts in descending order
 *   lastName=Smith                 a field filter comparing with the value the client gives
 *   age.gte=18                     the same, with an operator the client chooses: eq, ne, lt, lte, gt, gte
 *   lastName.prefix=Sm             a named field filter, here a predicate with an argument
 *   status.active=true             a filter the client only switches on: a fixed value, another field, or a
 *                                  predicate without an argument
 *   adults=true, nearby=5          named filters of the model
 *
 * A field's unnamed definition takes the field's name, named ones <field>.<name>.
 */

const OP_NAMES: Record<Op, string> = { '=': 'eq', '!=': 'ne', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' };

const SWITCH: JsonSchema = { type: 'boolean' };

/** A parameter of a filter the client only switches on. */
const switchParameter = (name: string, condition: string) =>
    parameter(name, SWITCH, `With true, only records where ${condition}`);

/** Parameter names that list operations have or may have, which filters can't take. */
const RESERVED = ['limit', 'offset', 'sort'];

const key = (field: string, name: string) => name === '' ? field : `${field}.${name}`;

/** What the definition compares: the field, or function(field, row). */
const subject = (field: string, fn: string | undefined) => fn !== undefined ? `${fn}(${field}, row)` : field;

function fieldOf(model: ModelData, name: string, where: string): FieldData {
    const field = model.fields.find(f => f.name === name);
    if (field === undefined) throw new Error(`${where} of model ${model.metadata.name} names unknown field ${name}`);
    return field;
}

/** The sort parameter, if records can be sorted. */
export function sortParameter(model: ModelData): Record<string, any> | undefined {
    const keys: string[] = [];
    const explained: string[] = [];
    for (const field of model.fields) {
        for (const [name, definition] of Object.entries(sortDefinitions(field.sortable))) {
            const sortKey = key(field.name, name);
            const direction = definition.direction ?? 'both';
            if (direction !== 'desc') keys.push(sortKey);
            if (direction !== 'asc') keys.push(`-${sortKey}`);
            explained.push(`${sortKey}: by ${subject(field.name, definition.function)}${direction === 'both' ? '' : `, ${direction} only`}`);
        }
    }
    for (const [name, sortKeys] of Object.entries(model.sortings ?? {})) {
        for (const sortKey of sortKeys)
            if (sortKey.field !== undefined) fieldOf(model, sortKey.field, `Sort order ${name}`);
        keys.push(name);
        const order = sortKeys.map(k => `${k.field !== undefined ? subject(k.field, k.function) : `${k.function}(row)`}${k.direction === 'desc' ? ' desc' : ''}`);
        explained.push(`${name}: by ${order.join(', ')}`);
    }
    if (keys.length === 0) return undefined;
    const twice = keys.find((sortKey, i) => keys.indexOf(sortKey) !== i);
    if (twice !== undefined)
        throw new Error(`Sort key ${twice} of model ${model.metadata.name} is defined twice; rename a sort order`);
    return {
        name: 'sort', in: 'query', style: 'form', explode: false,
        description: `Sort keys, applied in order; - sorts in descending order. ${explained.join('; ')}.`,
        schema: { type: 'array', items: { type: 'string', enum: keys } },
    };
}

function fieldFilters(model: ModelData, field: FieldData, resolve: RefResolver): Record<string, any>[] {
    const parameters: Record<string, any>[] = [];
    const valueSchema = () => parameterSchema(field, resolve);
    for (const [name, definition] of Object.entries(filterDefinitions(field.filterable))) {
        const base = key(field.name, name);
        const compared = subject(field.name, definition.function);
        if (definition.ops !== undefined) {
            for (const op of definition.ops)
                parameters.push(parameter(`${base}.${OP_NAMES[op]}`, valueSchema(), `Only records where ${compared} ${op} the value`));
        } else if (definition.predicate !== undefined) {
            if (definition.argument === undefined)
                parameters.push(switchParameter(base, `${definition.predicate}(${field.name}, row) is true`));
            else {
                const schema = definition.argument === true ? valueSchema() : typeSchema(definition.argument, resolve, `argument of filter ${base}`);
                parameters.push(parameter(base, schema, `Only records where ${definition.predicate}(${field.name}, row, value) is true`));
            }
        } else parameters.push(comparison(model, base, compared, definition, valueSchema));
    }
    return parameters;
}

function comparison(model: ModelData, base: string, compared: string, definition: FilterDefinition, valueSchema: () => JsonSchema): Record<string, any> {
    if (definition.otherField !== undefined) {
        fieldOf(model, definition.otherField, `Filter ${base}`);
        return switchParameter(base, `${compared} ${definition.op} ${definition.otherField}`);
    }
    if (definition.value !== undefined)
        return switchParameter(base, `${compared} ${definition.op} ${JSON.stringify(definition.value)}`);
    return parameter(base, valueSchema(), `Only records where ${compared} ${definition.op} the value`);
}

function parameter(name: string, schema: JsonSchema, description: string): Record<string, any> {
    return { name, in: 'query', description, schema };
}

/** Parameters of the named filters of the model. */
function modelFilters(model: ModelData, resolve: RefResolver): Record<string, any>[] {
    return Object.entries(model.filters ?? {}).map(([name, filter]) => {
        if ('predicate' in filter) {
            if (filter.argument === undefined) return switchParameter(name, `${filter.predicate}(row) is true`);
            return parameter(name, typeSchema(filter.argument, resolve, `argument of filter ${name}`), `Only records where ${filter.predicate}(row, value) is true`);
        }
        fieldOf(model, filter.field, `Filter ${name}`);
        if (filter.otherField !== undefined) fieldOf(model, filter.otherField, `Filter ${name}`);
        const other = filter.otherField ?? JSON.stringify(filter.value);
        return switchParameter(name, `${filter.field} ${filter.op} ${other}`);
    });
}

/** Sort and filter parameters of the list operation of the model. */
export function queryParameters(model: ModelData, resolve: RefResolver): Record<string, any>[] {
    const sort = sortParameter(model);
    const filters = [
        ...model.fields.flatMap(field => fieldFilters(model, field, resolve)),
        ...modelFilters(model, resolve),
    ];
    const names = new Set(RESERVED);
    for (const { name } of filters) {
        if (names.has(name))
            throw new Error(`Query parameter ${name} of model ${model.metadata.name} is defined twice; rename a filter`);
        names.add(name);
    }
    return [...(sort !== undefined ? [sort] : []), ...filters];
}
