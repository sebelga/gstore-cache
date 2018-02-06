'use strict';

/**
 * Convert a Google Datastore Key to a unique string id
 * It concatenates the namespace with the key path Array
 * @param {Datastore.Key} key The Google Datastore Key
 */
const dsKeyToString = key => {
    let id = key.namespace || '';
    id += key.path.join('');
    return id;
};

module.exports = {
    datastore: {
        dsKeyToString,
    },
};
