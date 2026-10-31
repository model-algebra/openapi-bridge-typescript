/** Model name to the name of its schema component: "User db model" becomes "UserDbModel". */
export declare function componentName(modelName: string): string;
/** English plural of a word, for the simple cases: user -> users, category -> categories, box -> boxes. */
export declare function plural(word: string): string;
/** Path of the collection of a model: UserProfile -> /user-profiles. */
export declare function collectionPath(modelName: string): string;
//# sourceMappingURL=names.d.ts.map