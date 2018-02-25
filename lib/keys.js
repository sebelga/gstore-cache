'use strict';

const arrify = require('arrify');

const utils = require('./utils');

const { dsKeyToString } = utils.datastore;
const { is } = utils;

/**
 * gstore-node error code when entity is not found.
 */
const ERR_ENTITY_NOT_FOUND = 'ERR_ENTITY_NOT_FOUND';

const getTTL = (cache, options) => {
    if (options && options.ttl) {
        /**
         * options takes over the cache config
         */
        if (is.object(options.ttl)) {
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
        return (data, storeName) => cache.config.ttl.stores[storeName].keys;
    }
    return cache.config.ttl.keys;
};

module.exports = cache => {
    const addCachePrefixKeys = key => cache.config.cachePrefix.keys + key;
    const keyToString = key => addCachePrefixKeys(dsKeyToString(key));

    /**
     * Order a list of entities according to a list of keys.
     * As the Datastore.get([...keys]) does not always maintain the order of the keys
     * passed, this will garantee that the key|value set in the cache is correct
     */
    const orderEntities = (entities, keys) => {
        const entitiesByKey = {};
        entities.forEach(entity => {
            if (typeof entity === 'undefined') {
                return;
            }
            entitiesByKey[keyToString(entity[cache.ds.KEY])] = entity;
        });
        return keys.map(key => entitiesByKey[keyToString(key)] || undefined);
    };

    // Add KEY Symbol to cache result
    const addKEYtoEntity = (entities, keys) =>
        entities.map((entity, i) => Object.assign({}, entity, { [cache.ds.KEY]: keys[i] }));

    const wrap = (_keys, ...args) => {
        let fetchHandler = args.length > 1 ? args[1] : args[0];

        if (typeof fetchHandler !== 'function') {
            /**
             * If no fetchHandler is passed, defaults to datastore.get()
             */
            fetchHandler = keys => cache.ds.get(keys);
        }

        const options = is.object(args[0]) ? args[0] : {};
        options.ttl = getTTL(cache, options);

        const keys = arrify(_keys);
        const isMultiple = keys.length > 1;

        /**
         * Convert the keys to unique string id
         */
        const stringKeys = keys.map(keyToString);
        const _args = [...stringKeys, options];

        if (isMultiple) {
            return cache.cacheManager.mget(..._args).then(onResult);
        }

        return cache.cacheManager.get(stringKeys[0], options).then(onResult);

        function onResult(_cacheResult) {
            const cacheResult = arrify(_cacheResult).filter(r => r !== undefined);

            if (cacheResult.length === 0) {
                /**
                 * No cache we need to fetch the keys
                 */
                return fetchHandler(keys).then(_fetchResult => {
                    // We make sure the order of the entities returned by the fetchHandler
                    // is the same as the order of the keys provided.
                    const fetchResult = orderEntities(arrify(_fetchResult[0]), keys);

                    // Prime the cache
                    return cache.primeCache(stringKeys, fetchResult, options);
                });
            }

            if (cacheResult.length !== keys.length) {
                /**
                 * The cache returned some entities but not all of them
                 */
                const cached = {};
                let strKey;

                const addToCache = entity => {
                    strKey = keyToString(entity[cache.ds.KEY]);
                    cached[strKey] = entity;
                };

                cacheResult.forEach(addToCache);
                const keysNotFound = keys.filter(k => cached[keyToString(k)] === undefined);

                return fetchHandler(keysNotFound)
                    .then(_fetchResult => {
                        // Make sure we the fetchResult is in the same order as the keys that we fetched
                        const fetchResult = orderEntities(arrify(_fetchResult[0]), keysNotFound);
                        fetchResult.forEach(addToCache);

                        /**
                         * Prime the cache
                         */
                        return cache.primeCache(keysNotFound.map(keyToString), fetchResult, options);
                    })
                    .catch(error => {
                        if (error.code === ERR_ENTITY_NOT_FOUND) {
                            // When we fetch *one* key and it is not found
                            // gstore.Model returns an error with 404 code.
                            strKey = keyToString(keysNotFound[0]);
                            cached[strKey] = null;
                            return;
                        }
                        throw new Error(error);
                    })
                    .then(() =>
                        // Map the keys to our cached map
                        // return "null" if no result
                        stringKeys.map(k => cached[k] || null)
                    );
            }
            return isMultiple ? addKEYtoEntity(cacheResult, keys) : addKEYtoEntity(cacheResult, keys)[0];
        }
    };

    const mget = (..._keys) => {
        const keys = _keys.map(k => keyToString(k));
        if (keys.length === 1) {
            return cache.get(keys[0]).then(_entity => {
                if (typeof _entity === 'undefined') {
                    return _entity;
                }
                return addKEYtoEntity([_entity], _keys)[0];
            });
        }

        return cache.mget(...keys).then(entities => addKEYtoEntity(entities, _keys));
    };

    const get = mget;

    const mset = (..._keysValues) => {
        // Convert Datastore Keys to unique string id
        const keysValues = _keysValues.map((kv, i) => {
            if (i % 2 === 0) {
                return addCachePrefixKeys(dsKeyToString(kv));
            }
            return kv;
        });

        const options = { ttl: getTTL(cache) };
        if (keysValues.length === 2) {
            return cache.set(keysValues[0], keysValues[1], options);
        }
        return cache.mset(...[...keysValues, options]);
    };

    const set = mset;

    const del = (...keys) => cache.del(keys.map(k => keyToString(k)));

    return {
        wrap,
        get,
        mget,
        set,
        mset,
        del,
    };
};
