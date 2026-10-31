const NULL = { type: 'null' };
const INTEGER_FORMATS = { INT16: 'int16', INT32: 'int32', integer: 'int32', INT64: 'int64' };
const STRING_FORMATS = {
    UUID: 'uuid', BYTES: 'byte', DATE: 'date', date: 'date', TIME: 'time',
    DATETIME: 'local-date-time', TIMESTAMP: 'local-date-time', TIMESTAMP_TZ: 'date-time', DURATION: 'duration',
};
const PRECISION_TYPES = new Set(['TIME', 'DATETIME', 'TIMESTAMP', 'TIMESTAMP_TZ', 'DURATION']);
/** Schema of values of a type, null not included. */
export function typeSchema(descriptor, resolve, where) {
    const params = descriptor.parameters ?? {};
    const type = descriptor.type;
    if (INTEGER_FORMATS[type] !== undefined)
        return { type: 'integer', format: INTEGER_FORMATS[type] };
    switch (type) {
        case 'FLOAT32': return { type: 'number', format: 'float' };
        case 'FLOAT64': return { type: 'number', format: 'double' };
        case 'number':
        case 'DECIMAL': {
            const schema = { type: 'number', format: 'decimal' };
            if (params.precision !== undefined)
                schema['x-precision'] = params.precision;
            if (params.scale !== undefined)
                schema['x-scale'] = params.scale;
            return schema;
        }
        case 'boolean':
        case 'BOOLEAN': return { type: 'boolean' };
        case 'STRING':
            return params.length !== undefined ? { type: 'string', maxLength: params.length } : { type: 'string' };
        case 'string':
        case 'TEXT': return { type: 'string' };
        case 'ENUM': {
            if (!Array.isArray(params.values) || params.values.length === 0)
                throw new Error(`ENUM ${where} requires parameters.values`);
            return { type: 'string', enum: [...params.values] };
        }
        case 'JSON':
        case 'object': return {};
        case 'OBJECT': {
            if (typeof params.ref !== 'string')
                throw new Error(`OBJECT ${where} requires parameters.ref`);
            const component = resolve(params.ref);
            return component !== undefined ? { $ref: `#/components/schemas/${component}` } : { type: 'object', 'x-ref': params.ref };
        }
        case 'UNION': {
            if (!Array.isArray(params.oneOf) || params.oneOf.length === 0)
                throw new Error(`UNION ${where} requires parameters.oneOf`);
            return { oneOf: params.oneOf.map((option) => typeSchema(option, resolve, where)) };
        }
        case 'array':
        case 'ARRAY': {
            const items = params.items;
            return { type: 'array', items: items === undefined ? {} : typeSchema(items, resolve, where) };
        }
    }
    const format = STRING_FORMATS[type];
    if (format === undefined)
        throw new Error(`Unsupported type ${type} of ${where}`);
    const schema = { type: 'string', format };
    if (PRECISION_TYPES.has(type) && params.precision !== undefined)
        schema['x-precision'] = params.precision;
    return schema;
}
/** Whether the schema says nothing about the type of values: any JSON value, null included, is valid. */
function untyped(schema) {
    return !['type', '$ref', 'oneOf', 'anyOf', 'not', 'enum', 'x-ref'].some(key => key in schema);
}
/** The schema also accepts null. */
function orNull(schema) {
    if (untyped(schema))
        return schema;
    if (typeof schema.type === 'string') {
        const result = { ...schema, type: [schema.type, 'null'] };
        if (Array.isArray(schema.enum))
            result.enum = [...schema.enum, null];
        return result;
    }
    if (Array.isArray(schema.oneOf))
        return { ...schema, oneOf: [...schema.oneOf, NULL] };
    return { anyOf: [schema, NULL] };
}
/** Schema of the property of a field in the schema of the model. */
export function fieldSchema(field, resolve) {
    const where = `field ${field.name}`;
    const c = (field.constraints ?? {});
    let schema = typeSchema(field, resolve, where);
    // Constraints JSON Schema can check
    if (c.enum !== undefined) {
        if (schema.type === 'array')
            schema.items = { ...schema.items, enum: [...c.enum] };
        else
            schema.enum = [...c.enum];
    }
    if (c.min !== undefined)
        schema.minimum = c.min;
    if (c.max !== undefined)
        schema.maximum = c.max;
    if (c.regex !== undefined)
        schema.pattern = c.regex;
    if (c.nullable !== false)
        schema = orNull(schema);
    // Any value but null
    else if (untyped(schema))
        schema.not = NULL;
    if (field.description !== undefined)
        schema = { description: field.description, ...schema };
    if (c.default !== undefined) {
        if ('value' in c.default)
            schema.default = c.default.value;
        else
            schema['x-default-function'] = c.default.function;
    }
    if (c.identity !== undefined) {
        schema.readOnly = true;
        schema['x-identity'] = c.identity;
    }
    if (c.primaryKey === true)
        schema['x-primary-key'] = true;
    if (c.unique === true)
        schema['x-unique'] = true;
    if (c.foreignKey !== undefined)
        schema['x-foreign-key'] = c.foreignKey;
    if (c.required === true)
        schema['x-required'] = true;
    if (field.targets !== undefined)
        schema['x-targets'] = field.targets;
    return schema;
}
/** The schema without x- extensions, at any depth: for request bodies and parameters. */
export function withoutExtensions(schema) {
    if (Array.isArray(schema))
        return schema.map(withoutExtensions);
    if (schema === null || typeof schema !== 'object')
        return schema;
    return Object.fromEntries(Object.entries(schema)
        .filter(([key]) => !key.startsWith('x-'))
        .map(([key, value]) => [key, key === 'default' || key === 'enum' ? value : withoutExtensions(value)]));
}
/** The schema of a path parameter: the value of the field, which can't be null. */
export function parameterSchema(field, resolve) {
    const schema = withoutExtensions(fieldSchema({ ...field, constraints: { ...field.constraints, nullable: false } }, resolve));
    delete schema.readOnly;
    delete schema.default;
    delete schema.description;
    return schema;
}
/*
 * Reading
 */
/** The schema without null among its values, and whether null was among them. */
function withoutNull(schema) {
    if (Array.isArray(schema.type) && schema.type.includes('null')) {
        const types = schema.type.filter((t) => t !== 'null');
        const result = { ...schema, type: types.length === 1 ? types[0] : types };
        if (Array.isArray(schema.enum))
            result.enum = schema.enum.filter((v) => v !== null);
        return { schema: result, nullable: true };
    }
    for (const key of ['anyOf', 'oneOf']) {
        if (!Array.isArray(schema[key]) || !schema[key].some(isNullSchema))
            continue;
        const options = schema[key].filter((option) => !isNullSchema(option));
        const { [key]: _, ...rest } = schema;
        return { schema: options.length === 1 && key === 'anyOf' ? { ...rest, ...options[0] } : { ...rest, [key]: options }, nullable: true };
    }
    if (isNullSchema(schema.not)) {
        const { not: _, ...rest } = schema;
        return { schema: rest, nullable: false };
    }
    return { schema, nullable: untyped(schema) };
}
const isNullSchema = (schema) => schema?.type === 'null';
const FORMAT_TYPES = {
    uuid: 'UUID', byte: 'BYTES', binary: 'BYTES', date: 'DATE', time: 'TIME',
    'local-date-time': 'TIMESTAMP', 'date-time': 'TIMESTAMP_TZ', duration: 'DURATION',
};
/** Type of the values of a schema. */
export function readType(schema, resolve) {
    if (typeof schema.$ref === 'string')
        return { type: 'OBJECT', parameters: { ref: resolve(schema.$ref) } };
    if (typeof schema['x-ref'] === 'string')
        return { type: 'OBJECT', parameters: { ref: schema['x-ref'] } };
    if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf))
        return { type: 'UNION', parameters: { oneOf: (schema.oneOf ?? schema.anyOf).map((option) => readType(option, resolve)) } };
    if (Array.isArray(schema.type))
        return { type: 'UNION', parameters: { oneOf: schema.type.map((type) => readType({ type }, resolve)) } };
    const precision = schema['x-precision'] !== undefined ? { parameters: { precision: schema['x-precision'] } } : {};
    switch (schema.type) {
        case 'integer':
            return { type: schema.format === 'int16' ? 'INT16' : schema.format === 'int64' ? 'INT64' : 'INT32' };
        case 'number': {
            if (schema.format === 'float')
                return { type: 'FLOAT32' };
            if (schema.format !== 'decimal')
                return { type: 'FLOAT64' };
            const parameters = {};
            if (schema['x-precision'] !== undefined)
                parameters.precision = schema['x-precision'];
            if (schema['x-scale'] !== undefined)
                parameters.scale = schema['x-scale'];
            return Object.keys(parameters).length > 0 ? { type: 'DECIMAL', parameters } : { type: 'DECIMAL' };
        }
        case 'boolean':
            return { type: 'BOOLEAN' };
        case 'string': {
            const type = FORMAT_TYPES[schema.format];
            if (type !== undefined)
                return PRECISION_TYPES.has(type) ? { type, ...precision } : { type };
            if (schema.maxLength !== undefined)
                return { type: 'STRING', parameters: { length: schema.maxLength } };
            if (Array.isArray(schema.enum))
                return { type: 'ENUM', parameters: { values: schema.enum } };
            return { type: 'TEXT' };
        }
        case 'array':
            return { type: 'ARRAY', parameters: { items: readType(withoutNull(schema.items ?? {}).schema, resolve) } };
        default:
            return { type: 'JSON' };
    }
}
/** The field of a property of the schema of a model. */
export function readField(name, property, required, resolve) {
    const { schema, nullable } = withoutNull(property);
    const { type, parameters } = readType(schema, resolve);
    const field = { name, type };
    if (property.description !== undefined)
        field.description = property.description;
    if (parameters !== undefined)
        field.parameters = parameters;
    const c = {};
    if (required && !nullable)
        c.nullable = false;
    // Allowed values the type does not express: of a STRING with a length, or of the items of an array
    if (Array.isArray(schema.enum) && type === 'STRING')
        c.enum = schema.enum;
    const items = type === 'ARRAY' ? withoutNull(schema.items ?? {}).schema : undefined;
    if (Array.isArray(items?.enum) && items.maxLength !== undefined)
        c.enum = items.enum;
    if (schema.minimum !== undefined)
        c.min = schema.minimum;
    if (schema.maximum !== undefined)
        c.max = schema.maximum;
    if (schema.pattern !== undefined)
        c.regex = schema.pattern;
    if ('default' in property)
        c.default = { value: property.default };
    if (property['x-default-function'] !== undefined)
        c.default = { function: property['x-default-function'] };
    if (property['x-identity'] !== undefined)
        c.identity = property['x-identity'];
    if (property['x-primary-key'] === true)
        c.primaryKey = true;
    if (property['x-unique'] === true)
        c.unique = true;
    if (property['x-foreign-key'] !== undefined)
        c.foreignKey = property['x-foreign-key'];
    if (property['x-required'] === true)
        c.required = true;
    if (Object.keys(c).length > 0)
        field.constraints = c;
    if (property['x-targets'] !== undefined)
        field.targets = property['x-targets'];
    return field;
}
//# sourceMappingURL=schemas.js.map