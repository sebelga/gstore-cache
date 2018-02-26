'use strict';

const ds = require('@google-cloud/datastore')();

// ----------------------------------------------------
// Strings
// ----------------------------------------------------

/**
 * Create a random string of characters
 */
const randomString = (length = 8) => {
    const chars = 'abcdefghiklmnopqrstuvwxyz';
    let randomStr = '';

    for (let i = 0; i < length; i += 1) {
        const rnum = Math.floor(Math.random() * chars.length);
        randomStr += chars.substring(rnum, rnum + 1);
    }

    return randomStr;
};

/**
 * Hash function
 *
 * @author darkskyapp
 * @link https://github.com/darkskyapp/string-hash
 */
const hashString = str => {
    /* eslint-disable no-bitwise, no-plusplus */

    let hash = 5381;
    let i = str.length;

    while (i) {
        hash = (hash * 33) ^ str.charCodeAt(--i);
    }

    /* JavaScript does bitwise operations on 32-bit signed
    * integers. Since we want the results to be always positive, convert the
    * signed int to an unsigned by doing an unsigned bitshift. */
    return hash >>> 0;
};

// ----------------------------------------------------
// Datastore
// ----------------------------------------------------

/**
 * Convert a Google Datastore Key to a unique string id
 * It concatenates the namespace with the key path Array
 * @param {Datastore.Key} key The Google Datastore Key
 */
const dsKeyToString = (key, options = { hash: true }) => {
    if (typeof key === 'undefined') {
        throw new Error('Key cannot be undefined.');
    }
    let id = key.namespace || '';
    id += key.path.join('');
    return options.hash ? hashString(id) : id;
};

/**
 * Convert a Google Datastore Query to a unique string id
 * It concatenates the namespace with the key path Array
 * @param {Datastore.Query} query The Google Datastore query
 */
const dsQueryToString = (query, options = { hash: true }) => {
    const array = [];
    array.push(query.kinds.join(''));
    array.push(query.namespace);
    array.push(
        query.filters.reduce((acc, filter) => {
            let str = acc + filter.name + filter.op;

            // When filtering with "hancestors"
            // the value is a Datastore Key.
            // we need to parse it as well
            if (ds.isKey(filter.val)) {
                str += dsKeyToString(filter.val, { hash: false });
            } else {
                str += filter.val;
            }
            return str;
        }, '')
    );

    array.push(query.groupByVal.join(''));
    array.push(query.limitVal);
    array.push(query.offsetVal);
    array.push(query.orders.reduce((acc, order) => acc + order.name + order.sign, ''));
    array.push(query.selectVal.join(''));
    array.push(query.startVal);
    array.push(query.endVal);

    const str = array.join('|');
    return options.hash ? hashString(str) : str;
};

// ----------------------------------------------------
// Misc
// ----------------------------------------------------

const isObject = value => value instanceof Object && value.constructor === Object;

/**
 * Get the ttl value for a cache type (Keys or Queries)
 * If options.ttl is defined, it takes over. Otherwise
 * we look in the cache.config.
 * For multi-store, a function is returned so the ttl can
 * be calculated dynamically for each store.
 */
const getTTL = (cache, options, type) => {
    if (options && options.ttl) {
        /**
         * options takes over the cache config
         */
        if (isObject(options.ttl)) {
            /**
             * For multi-stores, ttl options can also
             * be an object mapping the stores
             * ex: { memory: 600, redis: 900 }
             */
            const stores = Object.assign({}, options.ttl);
            return (data, storeName) => stores[storeName];
        }
        return options.ttl;
    }

    if (cache.config.stores.length > 1) {
        return (data, storeName) => cache.config.ttl.stores[storeName][type];
    }
    return cache.config.ttl[type];
};

module.exports = {
    datastore: {
        dsKeyToString,
        dsQueryToString,
    },
    string: {
        random: randomString,
        hash: hashString,
    },
    is: {
        object: isObject,
    },
    ttl: {
        getTTL,
    },
};
