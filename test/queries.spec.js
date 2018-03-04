'use strict';

const chai = require('chai');
const sinon = require('sinon');
const requireUncached = require('require-uncached');
const ds = require('@google-cloud/datastore')();
const nodeCacheManager = require('cache-manager');

const { datastore, string } = require('../lib/utils');
const { queries } = require('./mocks/datastore');
const StoreMock = require('./mocks/cache-store');

const { expect, assert } = chai;
const metaQuery = {
    endCursor: 'Cj4SOGoWZ3N0b3JlLWNhY2hlLWUyZS10Z==',
    moreResults: 'MORE_RESULTS_AFTER_LIMIT',
};

describe('gstoreCache.queries', () => {
    let gsCache;
    let queryToString;
    let cacheManager;
    let queryRes;
    let redisClient;
    let prefix;

    const [query1, query2, query3] = queries;

    const methods = {
        fetchHandler() {
            return Promise.resolve([]);
        },
    };

    describe('read()', () => {
        const gstoreCache = requireUncached('../lib');
        let defaultConfig;

        beforeEach(ready => {
            gsCache = gstoreCache.init();
            defaultConfig = Object.assign({}, gsCache.config);

            queryRes = [[{ name: string.random() }], metaQuery];
            sinon.stub(methods, 'fetchHandler').resolves(queryRes);

            const onReady = () => {
                prefix = gsCache.config.cachePrefix.queries;
                queryToString = query => prefix + datastore.dsQueryToString(query);
                ({ cacheManager } = gsCache);
                gsCache.removeListener('ready', onReady);
                ready();
            };
            gsCache.on('ready', onReady);
        });

        afterEach(() => {
            gsCache.removeAllListeners();
            // make sure we have the default config in
            // case it has been modified
            gsCache._config = defaultConfig;

            if (methods.fetchHandler.restore) {
                methods.fetchHandler.restore();
            }

            if (gsCache.cacheManager) {
                gsCache.cacheManager.reset();
            }
            if (gsCache.cacheManagerNoRedis) {
                gsCache.cacheManagerNoRedis.reset();
            }
        });

        it('should get query from fetchHandler', () => {
            const strQuery = queryToString(query1);
            sinon.spy(gsCache, 'primeCache');

            return gsCache.queries.read(query1, methods.fetchHandler).then(result => {
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

            return gsCache.queries.read(query1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result[0].name).equal(queryRes[0].name);
            });
        });

        it('should get query from cache (2)', () => {
            gsCache.config.global = false;
            cacheManager.set(queryToString(query1), queryRes);

            return gsCache.queries.read(query1, { cache: true }, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result[0].name).equal(queryRes[0].name);
            });
        });

        it('should prime the cache after fetch', () =>
            gsCache.queries.read(query1, methods.fetchHandler).then(() =>
                gsCache.cacheManager.get(queryToString(query1)).then(result => {
                    expect(result[0].name).equal(queryRes[0].name);
                })
            ));

        it('should get query from *default* fetchHandler', () => {
            sinon.stub(query1, 'run').resolves(queryRes);

            return gsCache.queries.read(query1, { cache: true }).then(result => {
                expect(query1.run.called).equal(true);
                expect(result[0].name).equal(queryRes[0].name);

                return cacheManager.get(queryToString(query1)).then(cacheResponse => {
                    expect(cacheResponse[0].name).equal(queryRes[0].name);
                });
            });
        });

        it('should set the TTL from config', () => {
            sinon.spy(gsCache.cacheManager, 'mset');

            return gsCache.queries.read(query1, methods.fetchHandler).then(() => {
                assert.ok(gsCache.cacheManager.mset.called);
                const { args } = gsCache.cacheManager.mset.getCall(0);
                expect(args[2].ttl).equal(5);
                gsCache.cacheManager.mset.restore();
            });
        });

        it('should set the TTL from options', () => {
            sinon.spy(gsCache.cacheManager, 'mset');

            return gsCache.queries.read(query1, { ttl: 556 }).then(() => {
                assert.ok(gsCache.cacheManager.mset.called);
                const { args } = gsCache.cacheManager.mset.getCall(0);
                expect(args[2].ttl).equal(556);
                gsCache.cacheManager.mset.restore();
            });
        });

        it('should set ttl dynamically when multistore', () =>
            new Promise(resolve => {
                const stores = {};
                sinon.stub(nodeCacheManager, 'caching').callsFake(storeName => {
                    const store = StoreMock(storeName);
                    stores[storeName] = store;
                    return store;
                });

                gsCache = gstoreCache.init({
                    config: {
                        stores: ['memory', 'redis'],
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
                    },
                    datastore: ds,
                });

                const onReady = () => {
                    gsCache.removeListener('ready', onReady);

                    sinon.spy(gsCache.cacheManagerNoRedis, 'mset');
                    sinon.spy(stores.memory.store, 'set');
                    sinon.spy(gsCache.redisClient, 'multi');

                    gsCache.queries.read(query1, methods.fetchHandler).then(() => {
                        const options = gsCache.cacheManagerNoRedis.mset.getCall(0).args[2];
                        const optMemory = stores.memory.store.set.getCall(0).args[2];
                        const argsRedis = gsCache.redisClient.multi.getCall(0).args[0];

                        expect(typeof options.ttl).equal('function');
                        expect(optMemory.ttl).equal(1357);
                        expect(argsRedis[1]).contains('setex');
                        expect(argsRedis[1]).contains(2468);

                        return gsCache.queries.read(query1, { ttl: { memory: 4455, redis: 6677 } }).then(() => {
                            const options2 = gsCache.cacheManagerNoRedis.mset.getCall(0).args[2];
                            const optMemory2 = stores.memory.store.set.getCall(1).args[2];
                            const argsRedis2 = gsCache.redisClient.multi.getCall(1).args[0];

                            expect(typeof options2.ttl).equal('function');
                            expect(optMemory2.ttl).equal(4455);
                            expect(argsRedis2[1]).contains('setex');
                            expect(argsRedis2[1]).contains(6677);

                            gsCache.cacheManagerNoRedis.mset.restore();
                            stores.memory.store.set.restore();
                            gsCache.redisClient.multi.restore();
                            nodeCacheManager.caching.restore();

                            gsCache.deleteCacheManager(() => {
                                resolve();
                            });
                        });
                    });
                };

                gsCache.on('ready', onReady);
            }));

        it('should bubble up the error from the fetch', done => {
            const error = new Error('Houston we got an error');
            methods.fetchHandler.rejects(error);

            gsCache.queries.read(query1, methods.fetchHandler).catch(err => {
                expect(err.message).equal('Houston we got an error');
                done();
            });
        });

        describe('when redis cache present', () => {
            let cache;

            beforeEach(() => {
                sinon.spy(gsCache, 'primeCache');
                sinon.spy(gsCache.queries, 'kset');
            });

            afterEach(() => {
                gsCache.primeCache.restore();
                gsCache.queries.kset.restore();
            });

            it('should not prime the cache and save the query in its entity Kind Set', done => {
                cache = StoreMock('redis');

                gsCache = gstoreCache.init({
                    config: {
                        stores: [cache],
                        ttl: {
                            stores: { redis: { queries: 0 } }, // when set to "0" triggers infinite cache
                        },
                    },
                    datastore: ds,
                });

                const onReady = () => {
                    gsCache.removeListener('ready', onReady);
                    const queryKey = queryToString(query1);

                    gsCache.queries.read(query1, methods.fetchHandler).then(result => {
                        expect(gsCache.primeCache.called).equal(false);
                        expect(gsCache.queries.kset.called).equal(true);

                        const { args } = gsCache.queries.kset.getCall(0);
                        expect(args[0]).equal(queryKey);
                        expect(args[1][0][0]).contains(queryRes[0][0]);
                        expect(args[1][1]).equal(queryRes[1]);
                        expect(args[2]).equal('Company');
                        expect(result).equal(queryRes);
                        done();
                    });
                };
                gsCache.on('ready', onReady);
            });
        });
    });

    describe('get()', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init();
            queryRes = [{ name: string.random() }, metaQuery];

            const onReady = () => {
                prefix = gsCache.config.cachePrefix.queries;
                queryToString = query => prefix + datastore.dsQueryToString(query);
                gsCache.removeListener('ready', onReady);
                done();
            };
            gsCache.on('ready', onReady);
        });

        it('should get query from cache', () =>
            gsCache.queries.set(query1, queryRes).then(() =>
                gsCache.queries.get(query1).then(res => {
                    expect(res).deep.equal(queryRes);
                })
            ));

        it('should get multiple queries from cache', () => {
            const queryRes2 = [[{ name: string.random() }], metaQuery];
            return gsCache.queries.mset(query1, queryRes, query2, queryRes2).then(() =>
                gsCache.queries.mget(query1, query2).then(res => {
                    expect(res[0]).deep.equal(queryRes);
                    expect(res[1]).deep.equal(queryRes2);
                })
            );
        });
    });

    describe('set()', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init();
            queryRes = [[{ name: string.random() }], metaQuery];

            const onReady = () => {
                prefix = gsCache.config.cachePrefix.queries;
                queryToString = query => prefix + datastore.dsQueryToString(query);
                gsCache.removeListener('ready', onReady);
                sinon.spy(gsCache, 'set');
                done();
            };
            gsCache.on('ready', onReady);
        });

        afterEach(() => {
            if (gsCache.set.restore) {
                gsCache.set.restore();
            }
        });

        it('should add Datastore Query to cache', () =>
            gsCache.queries.set(query1, queryRes).then(result => {
                assert.ok(gsCache.set.called);
                const { args } = gsCache.set.getCall(0);
                expect(args[0]).equal(queryToString(query1));
                expect(result).deep.equal(queryRes);
            }));

        it('should set the TTL from config', () =>
            gsCache.queries.set(query1, queryRes).then(() => {
                const { args } = gsCache.set.getCall(0);
                expect(args[2].ttl).equal(5);
            }));

        it('should set the TTL from options', () =>
            gsCache.queries.set(query1, queryRes, { ttl: 6969 }).then(() => {
                const { args } = gsCache.set.getCall(0);
                expect(args[2].ttl).equal(6969);
            }));

        it('should set ttl dynamically when multistore', done => {
            const stores = {};
            sinon.stub(nodeCacheManager, 'caching').callsFake(storeName => {
                const store = StoreMock(storeName);
                stores[storeName] = store;
                return store;
            });

            gsCache = gstoreCache.init({
                config: {
                    stores: ['memory', 'redis'],
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
                },
                datastore: ds,
            });

            const onReady = () => {
                gsCache.removeAllListeners();

                sinon.spy(gsCache.cacheManagerNoRedis, 'mset');
                sinon.spy(stores.memory.store, 'set');
                sinon.spy(gsCache.redisClient, 'multi');

                return gsCache.queries.set(query1, queryRes).then(() => {
                    const options = gsCache.cacheManagerNoRedis.mset.getCall(0).args[2];
                    const optMemory = stores.memory.store.set.getCall(0).args[2];
                    const argsRedis = gsCache.redisClient.multi.getCall(0).args[0];

                    expect(typeof options.ttl).equal('function');
                    expect(optMemory.ttl).equal(1357);
                    expect(argsRedis[1]).contains('setex');
                    expect(argsRedis[1]).contains(2468);

                    gsCache.cacheManagerNoRedis.mset.restore();
                    stores.memory.store.set.restore();
                    gsCache.redisClient.multi.restore();
                    nodeCacheManager.caching.restore();
                    done();
                });
            };

            gsCache.on('ready', onReady);
        });

        describe('when redis cache present', () => {
            let cache;

            beforeEach(() => {
                sinon.spy(gsCache.queries, 'kset');
            });
            afterEach(() => {
                gsCache.queries.kset.restore();
            });

            it('should not prime the cache and save the query in its entity Kind Set', done => {
                cache = StoreMock('redis');

                gsCache = gstoreCache.init({
                    config: {
                        stores: [cache],
                        ttl: {
                            queries: 333,
                        },
                    },
                    datastore: ds,
                });

                const onReady = () => {
                    sinon.spy(gsCache, 'set');
                    sinon.spy(gsCache.redisClient, 'multi');

                    gsCache.queries.set(query1, queryRes).then(() => {
                        expect(gsCache.set.called).equal(false);
                        expect(gsCache.queries.kset.called).equal(false);

                        const argsRedis = gsCache.redisClient.multi.getCall(0).args[0];
                        expect(argsRedis[1]).contains('setex');
                        expect(argsRedis[1]).contains(333);

                        gsCache.redisClient.multi.restore();
                        gsCache.deleteCacheManager(() => {
                            done();
                        });
                    });

                    gsCache.removeAllListeners();
                };
                gsCache.on('ready', onReady);
            });
        });
    });

    describe('mset()', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init();
            queryRes = [[{ name: string.random() }], metaQuery];

            const onReady = () => {
                prefix = gsCache.config.cachePrefix.queries;
                queryToString = query => prefix + datastore.dsQueryToString(query);
                gsCache.removeListener('ready', onReady);
                sinon.spy(gsCache, 'mset');
                done();
            };
            gsCache.on('ready', onReady);
        });

        afterEach(() => {
            gsCache.mset.restore();
        });

        it('should add Datastore Query to cache', () => {
            const queryRes2 = [[{ name: string.random() }], metaQuery];
            return gsCache.queries.mset(query1, queryRes, query2, queryRes2).then(result => {
                assert.ok(gsCache.mset.called);
                const { args } = gsCache.mset.getCall(0);
                expect(args[0]).equal(queryToString(query1));
                expect(args[1]).equal(queryRes);
                expect(args[2]).equal(queryToString(query2));
                expect(args[3]).equal(queryRes2);
                expect(result).include.members([queryRes, queryRes2]);
            });
        });

        it('should set the TTL from config', () => {
            const queryRes2 = [[{ name: string.random() }], metaQuery];
            return gsCache.queries.set(query1, queryRes, query2, queryRes2).then(() => {
                const { args } = gsCache.mset.getCall(0);
                expect(args[4].ttl).equal(5);
            });
        });

        it('should set the TTL from options', () => {
            const queryRes2 = [[{ name: string.random() }], metaQuery];
            return gsCache.queries.set(query1, queryRes, query2, queryRes2, { ttl: 7744 }).then(() => {
                const { args } = gsCache.mset.getCall(0);
                expect(args[4].ttl).equal(7744);
            });
        });

        describe('when redis cache present', () => {
            let cache;

            beforeEach(() => {
                sinon.spy(gsCache.queries, 'kset');
            });
            afterEach(() => {
                gsCache.queries.kset.restore();
            });

            it('should not prime the cache and save the query in its entity Kind Set', done => {
                cache = StoreMock('redis');

                gsCache = gstoreCache.init({
                    config: {
                        stores: [cache],
                        ttl: {
                            stores: { redis: { queries: 0 } },
                        },
                    },
                    datastore: ds,
                });

                const onReady = () => {
                    sinon.spy(gsCache, 'mset');
                    const queryKey = queryToString(query1);
                    const queryKey2 = queryToString(query2);
                    const queryRes2 = [[{ name: string.random() }], metaQuery];

                    gsCache.queries.mset(query1, queryRes, query2, queryRes2).then(result => {
                        expect(gsCache.mset.called).equal(false);
                        expect(gsCache.queries.kset.callCount).equal(2);

                        const { args: args1 } = gsCache.queries.kset.getCall(0);
                        const [qKey, qValue, qEntiyKind] = args1;
                        expect(qKey).equal(queryKey);
                        expect(qValue[0][0]).contains(queryRes[0][0]);
                        expect(qValue[1]).equal(queryRes[1]);
                        expect(qEntiyKind).equal('Company');

                        const { args: args2 } = gsCache.queries.kset.getCall(1);
                        expect(args2[0]).equal(queryKey2);
                        expect(args2[1][0][0]).contains(queryRes2[0][0]);
                        expect(args2[2]).equal('User');
                        expect(result).deep.equal([queryRes, queryRes2]);
                        done();
                    });

                    gsCache.removeAllListeners();
                };
                gsCache.on('ready', onReady);
            });
        });
    });

    describe('del()', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init();
            queryRes = [{ name: string.random() }, metaQuery];

            const onReady = () => {
                sinon.spy(gsCache, 'del');
                prefix = gsCache.config.cachePrefix.queries;
                queryToString = query => prefix + datastore.dsQueryToString(query);
                gsCache.removeListener('ready', onReady);
                done();
            };
            gsCache.on('ready', onReady);
        });

        afterEach(() => {
            gsCache.del.restore();
        });

        it('should delete 1 query from cache', () =>
            gsCache.queries.del(query1).then(() => {
                assert.ok(gsCache.del.called);
                const { args } = gsCache.del.getCall(0);
                expect(args[0]).deep.equal([queryToString(query1)]);
            }));

        it('should delete multiple queries from cache', () =>
            gsCache.queries.del(query1, query2, query3).then(() => {
                assert.ok(gsCache.del.called);
                const { args } = gsCache.del.getCall(0);
                expect(args[0][0]).deep.equal(queryToString(query1));
                expect(args[0][1]).deep.equal(queryToString(query2));
                expect(args[0][2]).deep.equal(queryToString(query3));
            }));
    });

    describe('kset', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init({
                config: {
                    stores: [StoreMock('redis')],
                },
            });
            queryRes = [{ name: string.random() }, metaQuery];
            sinon.spy(methods, 'fetchHandler');

            const onReady = () => {
                prefix = gsCache.config.cachePrefix.queries;
                queryToString = query => prefix + datastore.dsQueryToString(query);
                ({ cacheManager, redisClient } = gsCache);
                gsCache.removeListener('ready', onReady);
                done();
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

            return gsCache.queries.kset(queryKey, queryRes, 'User').then(() => {
                assert.ok(redisClient.multi.called);
                const { args } = redisClient.multi.getCall(0);
                expect(args[0][0]).deep.equal(['sadd', `${prefix}User`, queryKey]);
                expect(args[0][1]).deep.equal(['set', queryKey, JSON.stringify(queryRes)]);

                redisClient.multi.restore();
            });
        });

        it('should allow an unlimited number of entity Kinds for a query', () => {
            const queryKey = queryToString(query1);
            sinon.spy(redisClient, 'multi');

            return gsCache.queries.kset(queryKey, queryRes, ['User', 'Task', 'Post']).then(() => {
                assert.ok(redisClient.multi.called);
                const { args } = redisClient.multi.getCall(0);
                expect(args[0][0]).deep.equal(['sadd', `${prefix}User`, queryKey]);
                expect(args[0][1]).deep.equal(['sadd', `${prefix}Task`, queryKey]);
                expect(args[0][2]).deep.equal(['sadd', `${prefix}Post`, queryKey]);
                expect(args[0][3]).deep.equal(['set', queryKey, JSON.stringify(queryRes)]);

                redisClient.multi.restore();
            });
        });

        it('should return the response from Redis', () => {
            const response = 'OK';
            redisClient.multi = () => ({
                exec: cb => cb(null, response),
            });

            return gsCache.queries.kset().then(res => {
                expect(res).equal(response);
            });
        });

        it('should bubble up error', () => {
            const error = new Error('Houston we got a problem');
            sinon.stub(redisClient, 'multi').callsFake(() => ({ exec: cb => cb(error) }));

            return gsCache.queries.kset().catch(err => {
                expect(err).equal(error);
                redisClient.multi.restore();
            });
        });

        it('should throw an Error if no Redis client', done => {
            gsCache = gstoreCache.init({});

            const onReady = () => {
                gsCache.removeListener('ready', onReady);

                gsCache.queries.kset().catch(err => {
                    expect(err.message).equal('No Redis Client found.');
                    done();
                });
            };
            gsCache.on('ready', onReady);
        });
    });

    describe('clearQueriesEntityKind', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(ready => {
            gsCache = gstoreCache.init({
                config: {
                    stores: [StoreMock('redis')],
                },
            });
            queryRes = [{ name: string.random() }, metaQuery];
            sinon.spy(methods, 'fetchHandler');

            const onReady = () => {
                prefix = gsCache.config.cachePrefix.queries;
                queryToString = query => prefix + datastore.dsQueryToString(query);
                ({ cacheManager, redisClient } = gsCache);
                gsCache.removeListener('ready', onReady);
                ready();
            };
            gsCache.on('ready', onReady);
        });

        afterEach(() => {
            methods.fetchHandler.restore();
            gsCache.removeAllListeners();
        });

        it('should remove all queries keys from entityKind Set and their cache', () => {
            sinon.stub(redisClient, 'multi').callsFake(() => ({
                exec: cb => cb(null, [['abc', 'def']]),
            }));
            sinon.stub(redisClient, 'del').callsFake((keys, cb) => cb(null, 7));

            return gsCache.queries.clearQueriesEntityKind('User').then(res => {
                assert.ok(redisClient.multi.called);
                assert.ok(redisClient.del.called);
                const { args: argsMulti } = redisClient.multi.getCall(0);
                const { args: argsDel } = redisClient.del.getCall(0);

                const setQueries = `${prefix}User`;
                expect(argsMulti[0][0]).deep.equal(['smembers', setQueries]);
                expect(argsDel[0]).include.members(['abc', 'def', setQueries]);
                expect(res).equal(7);

                redisClient.multi.restore();
                redisClient.del.restore();
            });
        });

        it('should bubble up errors from "smembers" call', done => {
            const error = new Error('Houston we really got a problem');
            sinon.stub(redisClient, 'multi').callsFake(() => ({ exec: cb => cb(error) }));

            gsCache.queries.clearQueriesEntityKind('User').catch(err => {
                expect(err).equal(error);

                redisClient.multi.restore();
                done();
            });
        });

        it('should bubble up errors from "del" call', done => {
            const error = new Error('Houston we really got a problem');
            sinon.stub(redisClient, 'multi').returns({ exec: cb => cb(null, []) });
            sinon.stub(redisClient, 'del').callsFake((key, cb) => {
                cb(error);
            });

            gsCache.queries.clearQueriesEntityKind('User').catch(err => {
                expect(err).equal(error);
                redisClient.del.restore();
                done();
            });
        });

        it('should throw an Error if no Redis client', done => {
            gsCache = gstoreCache.init({});

            const onReady = () => {
                gsCache.removeListener('ready', onReady);

                gsCache.queries.clearQueriesEntityKind('EntiyKind').catch(err => {
                    expect(err.message).equal('No Redis Client found.');
                    done();
                });
            };
            gsCache.on('ready', onReady);
        });
    });
});
