'use strict';

const chai = require('chai');
const sinon = require('sinon');

const GstoreCache = require('../lib');
const { datastore, string } = require('../lib/utils');
const { queries } = require('./mocks/datastore');
const StoreMock = require('./mocks/cache-store');

const { expect, assert } = chai;

describe('gstoreCache.queries', () => {
    let gsCache;
    let queryToString;
    let cacheManager;
    let queryRes;
    let redisClient;
    let prefix;

    const [query1] = queries;

    const methods = {
        fetchHandler() {
            return Promise.resolve([]);
        },
    };

    describe('get()', () => {
        beforeEach(ready => {
            gsCache = GstoreCache(true);
            queryRes = [{ name: string.random() }];
            sinon.spy(methods, 'fetchHandler');

            const onReady = () => {
                queryToString = query => gsCache.config.cachePrefix.queries + datastore.dsQueryToString(query);
                ({ cacheManager } = gsCache);
                gsCache.removeListener('ready', onReady);
                ready();
            };
            gsCache.on('ready', onReady);
        });

        afterEach(() => {
            if (methods.fetchHandler.restore) {
                methods.fetchHandler.restore();
            }
            gsCache.removeAllListeners();
        });

        it('should get query from fetchHandler', () => {
            const strQuery = queryToString(query1);
            methods.fetchHandler.restore();
            sinon.stub(methods, 'fetchHandler').resolves(queryRes);
            sinon.spy(gsCache, 'primeCache');

            return gsCache.queries.get(query1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(result).equal(queryRes);
                expect(gsCache.primeCache.getCall(0).args[0]).equal(strQuery);

                return cacheManager.get(strQuery).then(cacheResponse => {
                    expect(cacheResponse[0].name).equal(queryRes[0].name);

                    gsCache.primeCache.restore();
                });
            });
        });

        it('should get query from cache (1)', () => {
            cacheManager.set(queryToString(query1), queryRes);

            return gsCache.queries.get(query1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result[0].name).equal(queryRes[0].name);
            });
        });

        it('should get query from cache (2)', () => {
            gsCache.config.global = false;
            cacheManager.set(queryToString(query1), queryRes);

            return gsCache.queries.get(query1, { cache: true }, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result[0].name).equal(queryRes[0].name);
            });
        });

        it('should *not* get query from cache (1)', () => {
            cacheManager.set(queryToString(query1), queryRes);
            gsCache.config.global = false;

            return gsCache.queries.get(query1, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should *not* get query from cache (2)', () => {
            cacheManager.set(queryToString(query1), queryRes);

            return gsCache.queries.get(query1, { cache: false }, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should *not* get query from cache (3)', () => {
            cacheManager.set(queryToString(query1), queryRes);

            // When ttl is set to "-1" don't cache
            gsCache.config.ttl = Object.assign({}, gsCache.config.ttl, { queries: -1 });

            return gsCache.queries.get(query1, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should prime the cache after fetch', () => {
            methods.fetchHandler.restore();
            sinon.stub(methods, 'fetchHandler').resolves(queryRes);

            return gsCache.queries.get(query1, methods.fetchHandler).then(() =>
                cacheManager.get(queryToString(query1)).then(result => {
                    expect(result[0].name).equal(queryRes[0].name);
                })
            );
        });

        it('should set ttl dynamically when multistore', done => {
            const memoryCache = StoreMock();
            const redisCache = StoreMock('redis');

            gsCache = GstoreCache({
                stores: [memoryCache, redisCache],
                ttl: {
                    stores: {
                        memory: {
                            queries: 1357,
                        },
                        redis: {
                            queries: 2468,
                        },
                    },
                },
            });

            const onReady = () => {
                sinon.spy(gsCache.cacheManager, 'mset');
                sinon.spy(memoryCache.store, 'set');
                sinon.spy(redisCache.store, 'set');

                return gsCache.queries.get(query1, methods.fetchHandler).then(() => {
                    const options = gsCache.cacheManager.mset.getCall(0).args[2];
                    const optMemory = memoryCache.store.set.getCall(0).args[2];
                    const optRedis = redisCache.store.set.getCall(0).args[2];

                    expect(typeof options.ttl).equal('function');
                    expect(optMemory.ttl).equal(1357);
                    expect(optRedis.ttl).equal(2468);

                    gsCache.deleteCacheManager(() => {
                        gsCache.removeAllListeners();
                        done();
                    });
                });
            };

            gsCache.on('ready', onReady);
        });

        describe('when redis cache present', () => {
            let cache;

            beforeEach(() => {
                sinon.spy(gsCache, 'primeCache');
                sinon.spy(gsCache.queries, 'cacheQueryEntityKind');
            });
            afterEach(() => {
                gsCache.primeCache.restore();
                gsCache.queries.cacheQueryEntityKind.restore();
            });

            it('should not prime the cache and save query of Entity Kind', done => {
                cache = StoreMock('redis');
                // We need Promise version of the mock store
                cache.store.get = () => Promise.resolve();
                cache.store.mset = () => Promise.resolve();

                gsCache = GstoreCache({
                    stores: [cache],
                    ttl: {
                        stores: { redis: { queries: 0 } }, // when set to "0" triggers infinite cache
                    },
                });

                const onReady = () => {
                    const queryKey = queryToString(query1);

                    methods.fetchHandler.restore();
                    sinon.stub(methods, 'fetchHandler').resolves(queryRes);

                    gsCache.queries.get(query1, methods.fetchHandler).then(result => {
                        expect(gsCache.primeCache.called).equal(false);
                        expect(gsCache.queries.cacheQueryEntityKind.called).equal(true);

                        const { args } = gsCache.queries.cacheQueryEntityKind.getCall(0);
                        expect(args[0]).equal('Company');
                        expect(args[1]).equal(queryKey);
                        expect(args[2]).equal(queryRes);
                        expect(result).equal(queryRes);
                        done();
                    });

                    gsCache.removeAllListeners();
                };
                gsCache.on('ready', onReady);
            });

            it('should still prime the cache and *not** save query for Entity Kind', done => {
                cache = StoreMock('redis');
                cache.store.get = () => Promise.resolve();
                cache.store.mset = () => Promise.resolve();

                gsCache = GstoreCache({
                    stores: [cache],
                    ttl: {
                        stores: { redis: { queries: 10 } }, // when set to "0" triggers infinite cache
                    },
                });

                const onReady = () => {
                    methods.fetchHandler.restore();
                    sinon.stub(methods, 'fetchHandler').resolves(queryRes);

                    gsCache.queries.get(query1, methods.fetchHandler).then(() => {
                        expect(gsCache.primeCache.called).equal(true);
                        expect(gsCache.queries.cacheQueryEntityKind.called).equal(false);
                        done();
                    });

                    gsCache.removeAllListeners();
                };
                gsCache.on('ready', onReady);
            });
        });
    });

    describe('cacheQueryEntityKind', () => {
        beforeEach(ready => {
            gsCache = GstoreCache({
                stores: [StoreMock('redis')],
            });
            queryRes = [{ name: string.random() }];
            sinon.spy(methods, 'fetchHandler');

            const onReady = () => {
                queryToString = query => gsCache.config.cachePrefix.queries + datastore.dsQueryToString(query);
                ({ cacheManager, redisClient } = gsCache);
                gsCache.removeListener('ready', onReady);
                prefix = gsCache.config.cachePrefix.queries;
                ready();
            };
            gsCache.on('ready', onReady);
        });

        afterEach(() => {
            methods.fetchHandler.restore();
            gsCache.removeAllListeners();
        });

        it('should add queryKey to entityKind Redis set', () => {
            const queryKey = queryToString(query1);
            sinon.spy(redisClient, 'multi');

            return gsCache.queries.cacheQueryEntityKind('User', queryKey, queryRes).then(() => {
                assert.ok(redisClient.multi.called);
                const { args } = redisClient.multi.getCall(0);
                expect(args[0][0]).deep.equal(['sadd', `${prefix}User`, queryKey]);
                expect(args[0][1]).deep.equal(['set', queryKey, JSON.stringify(queryRes)]);
            });
        });

        it('should return the response from Redis', () => {
            const response = 'OK';
            redisClient.multi = () => ({
                exec: cb => cb(null, response),
            });

            return gsCache.queries.cacheQueryEntityKind().then(res => {
                expect(res).equal(response);
            });
        });

        it('should bubbble up error', () => {
            const error = new Error('Houston we got a problem');
            const mock = {
                exec: cb => cb(error),
            };
            redisClient.multi = () => mock;

            return gsCache.queries.cacheQueryEntityKind().catch(err => {
                expect(err).equal(error);
            });
        });
    });
});
