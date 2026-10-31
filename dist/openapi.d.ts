/** A JSON Schema (draft 2020-12, as OpenAPI 3.1 uses it), possibly with x- extensions. */
export type JsonSchema = Record<string, any>;
export interface OpenApiServer {
    url: string;
    description?: string;
}
/** The parts of an OpenAPI 3.1 document this bridge writes and reads. */
export interface OpenApiDocument {
    openapi: string;
    info: {
        title: string;
        version: string;
        description?: string;
    };
    servers?: OpenApiServer[];
    tags?: Array<{
        name: string;
        description?: string;
    }>;
    paths: Record<string, Record<string, any>>;
    components?: {
        schemas?: Record<string, JsonSchema>;
        parameters?: Record<string, any>;
        responses?: Record<string, any>;
    };
}
export declare const OPENAPI_VERSION = "3.1.0";
//# sourceMappingURL=openapi.d.ts.map