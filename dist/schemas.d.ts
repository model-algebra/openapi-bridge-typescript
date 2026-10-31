import type { FieldData } from "model-algebra-typescript";
import type { JsonSchema } from "./openapi.js";
/** Type of a field or of the items of an array: type and parameters. */
interface TypeDescriptor {
    type: string;
    parameters?: Record<string, any>;
}
/** Finds the name of the schema component of a referenced model, if the document has one. */
export type RefResolver = (modelName: string) => string | undefined;
/** Schema of values of a type, null not included. */
export declare function typeSchema(descriptor: TypeDescriptor, resolve: RefResolver, where: string): JsonSchema;
/** Schema of the property of a field in the schema of the model. */
export declare function fieldSchema(field: FieldData, resolve: RefResolver): JsonSchema;
/** The schema without x- extensions, at any depth: for request bodies and parameters. */
export declare function withoutExtensions(schema: JsonSchema): JsonSchema;
/** The schema of a path parameter: the value of the field, which can't be null. */
export declare function parameterSchema(field: FieldData, resolve: RefResolver): JsonSchema;
/** Finds the model a $ref points to. */
export type ComponentResolver = (ref: string) => string;
/** Type of the values of a schema. */
export declare function readType(schema: JsonSchema, resolve: ComponentResolver): TypeDescriptor;
/** The field of a property of the schema of a model. */
export declare function readField(name: string, property: JsonSchema, required: boolean, resolve: ComponentResolver): FieldData;
export {};
//# sourceMappingURL=schemas.d.ts.map