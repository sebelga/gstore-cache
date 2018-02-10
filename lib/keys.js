'use strict';

const ds = require('@google-cloud/datastore')();
const arrify = require('arrify');

const utils = require('./utils');

const { dsKeyToString } = utils.datastore;

/**
 * gstore-node error code when entity is not found.
 */
const ERR_ENTITY_NOT_FOUND = 'ERR_ENTITY_NOT_FOUND';

module.exports = cache => {
    const addCachePrefixKeys = key => cache.config.cachePrefix.keys + key;
    const keyToString = key => addCachePrefixKeys(dsKeyToString(key));

    const get = (_keys, ...args) => {
        const fetchHandler = args.length > 1 ? args[1] : args[0];
        const options = args.length > 1 ? args[0] : {};

        if (
            !cache.cacheManager ||
            options.cache === false ||
            (cache.config.global === false && options.cache !== true)
        ) {
            return fetchHandler(_keys);
        }

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
                return fetchHandler(...keys).then(_fetchResult =>
                    // Prime the cache
                    cache.primeCache(stringKeys, arrify(_fetchResult))
                );
            }

            if (cacheResult.length !== keys.length) {
                /**
                 * The cache returned some entities but not all of them
                 */
                const cached = {};
                let strKey;

                const addToCache = entity => {
                    strKey = keyToString(entity[ds.KEY]);
                    cached[strKey] = entity;
                };

                cacheResult.forEach(addToCache);
                const keysNotFound = keys.filter(k => cached[keyToString(k)] === undefined);

                return fetchHandler(keysNotFound)
                    .then(_fetchResult => {
                        const fetchResult = arrify(_fetchResult);
                        fetchResult.forEach(addToCache);

                        /**
                         * Prime the cache
                         */
                        return cache.primeCache(keysNotFound.map(keyToString), fetchResult);
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
            return isMultiple ? cacheResult : cacheResult[0];
        }
    };

    return {
        get,
    };
};
