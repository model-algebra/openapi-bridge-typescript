import { filterOptions, sortOptions, type FilterOption } from "model-algebra-common";
import type { FieldData, ModelData } from "model-algebra-typescript";
import type { JsonSchema } from "./openapi.js";
import { parameterSchema, typeSchema, type RefResolver } from "./schemas.js";

/*
 * Query parameters of list operations, from how the model says records can be sorted and filtered, named by
 * sortOptions() and filterOptions() of model-algebra-common:
 *
 *   sort=lastName,-age,lastName.caseless,byName   sort keys in order; - sorts in descending order
 *   lastName=Smith                 a field filter comparing with the value the client gives
 *   age.gte=18                     the same, with an operator the client chooses: eq, ne, lt, lte, gt, gte
 *   lastName.prefix=Sm             a named field filter, here a predicate with an argument
 *   status.active=true             a filter the client only switches on: a fixed value, another field, or a
 *                                  predicate without an argument
 *   adults=true, nearby=5          named filters of the model
 */

const SWITCH: JsonSchema = { type: 'boolean' };

/** What a definition works on: the field, or function(field, row). */
const subject = (field: string, fn: string | undefined) => fn !== undefined ? `${fn}(${field}, row)` : field;

/** The sort parameter, if records can be sorted. */
export function sortParameter(model: ModelData): Record<string, any> | undefined {
    const options = sortOptions(model);
    if (options.length === 0) return undefined;
    const keys = options.flatMap(option => option.directions.map(direction => direction === 'asc' ? option.key : `-${option.key}`));
    const explained = options.map(option => {
        if (option.sortKeys !== undefined) {
            const order = option.sortKeys.map(k => `${k.field !== undefined ? subject(k.field, k.function) : `${k.function}(row)`}${k.direction === 'desc' ? ' desc' : ''}`);
            return `${option.key}: by ${order.join(', ')}`;
        }
        const only = option.directions.length === 1 ? `, ${option.directions[0]} only` : '';
        return `${option.key}: by ${subject(option.field!, option.definition!.function)}${only}`;
    });
    return {
        name: 'sort', in: 'query', style: 'form', explode: false,
        description: `Sort keys, applied in order; - sorts in descending order. ${explained.join('; ')}.`,
        schema: { type: 'array', items: { type: 'string', enum: keys } },
    };
}

/** What the filter keeps, e.g. "age >= the value" or "isBlank(email, row) is true". */
function condition(option: FilterOption): string {
    if (option.predicate !== undefined) {
        const args = [...(option.scope === 'field' ? [option.field] : []), 'row', ...(option.input === 'value' ? ['value'] : [])];
        return `${option.predicate}(${args.join(', ')}) is true`;
    }
    const other = option.otherField ?? (option.input === 'value' ? 'the value' : JSON.stringify(option.value));
    return `${subject(option.field!, option.function)} ${option.op} ${other}`;
}

function filterParameter(model: ModelData, option: FilterOption, resolve: RefResolver): Record<string, any> {
    if (option.input === 'switch')
        return { name: option.name, in: 'query', description: `With true, only records where ${condition(option)}`, schema: SWITCH };
    const schema = option.valueType === 'field'
        ? parameterSchema(model.fields.find(f => f.name === option.field) as FieldData, resolve)
        : typeSchema(option.valueType!, resolve, `argument of filter ${option.name}`);
    return { name: option.name, in: 'query', description: `Only records where ${condition(option)}`, schema };
}

/** Sort and filter parameters of the list operation of the model. */
export function queryParameters(model: ModelData, resolve: RefResolver): Record<string, any>[] {
    const sort = sortParameter(model);
    const filters = filterOptions(model).map(option => filterParameter(model, option, resolve));
    return [...(sort !== undefined ? [sort] : []), ...filters];
}
