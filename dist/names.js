// Names in the API derived from model names
/** Model name to the name of its schema component: "User db model" becomes "UserDbModel". */
export function componentName(modelName) {
    const words = modelName.split(/[^A-Za-z0-9]+/).filter(word => word.length > 0);
    const name = words.map(word => word[0].toUpperCase() + word.slice(1)).join('');
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name))
        throw new Error(`Model name ${JSON.stringify(modelName)} cannot be turned into a schema name`);
    return name;
}
/** English plural of a word, for the simple cases: user -> users, category -> categories, box -> boxes. */
export function plural(word) {
    if (/(s|x|z|ch|sh)$/i.test(word))
        return `${word}es`;
    if (/[^aeiou]y$/i.test(word))
        return `${word.slice(0, -1)}ies`;
    return `${word}s`;
}
/** Path of the collection of a model: UserProfile -> /user-profiles. */
export function collectionPath(modelName) {
    const kebab = componentName(modelName).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    return `/${plural(kebab)}`;
}
//# sourceMappingURL=names.js.map