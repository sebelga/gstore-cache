'use strict';

const utils = require('./utils');

const { dsQueryToString } = utils.datastore;

module.exports = cache => {
    const addCachePrefixKeys = key => cache.config.cachePrefix.queries + key;
    const keyToString = key => addCachePrefixKeys(dsQueryToString(key));

    const get = (query, ...args) => {
        const fetchHandler = args.length > 1 ? args[1] : args[0];
        const options = args.length > 1 ? args[0] : {};

        let ttl;
        if (cache.config.stores.length > 1) {
            ttl = (data, storeName) => cache.config.ttl.stores[storeName].queries;
        } else {
            ttl = cache.config.ttl.queries;
        }
        options.ttl = ttl;

        if (
            !cache.cacheManager ||
            ttl === -1 ||
            options.cache === false ||
            (cache.config.global === false && options.cache !== true)
        ) {
            return fetchHandler(query);
        }

        const strQuery = keyToString(query);

        return cache.cacheManager.get(strQuery, options).then(onResult);

        function onResult(cacheResult) {
            if (typeof cacheResult === 'undefined') {
                /**
                 * No cache we need to fetch the keys
                 */
                return fetchHandler(query).then(fetchResult =>
                    // Prime the cache
                    cache.primeCache(strQuery, fetchResult, options)
                );
            }

            return cacheResult;
        }
    };

    return {
        get,
    };
};
