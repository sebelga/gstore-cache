'use strict';

const chai = require('chai');
const sinon = require('sinon');
const requireUncached = require('require-uncached');

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

    const [query1, query2, query3] = queries;

    const methods = {
        fetchHandler() {
            return Promise.resolve([]);
        },
    };

    describe('wrap()', () => {
        const gstoreCache = requireUncached('../lib');
        let defaultConfig;

        beforeEach(ready => {
            gsCache = gstoreCache.init();
            defaultConfig = Object.assign({}, gsCache.config);

            queryRes = [{ name: string.random() }];
            sinon.spy(methods, 'fetchHandler');

            const onReady = () => {
                prefix = gsCache.config.cachePrefix.queries;
                queryToString = query => prefix + datastore.dsQueryToString(query);
                ({ cacheManager } = gsCache);
                gsCache.removeListener('ready', onReady);
                ready();
            };
            gsCache.on('ready', onReady);
        });

        afterEach(done => {
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
            done();
        });

        it('should get query from fetchHandler', () => {
            const strQuery = queryToString(query1);
            methods.fetchHandler.restore();
            sinon.stub(methods, 'fetchHandler').resolves(queryRes);
            sinon.spy(gsCache, 'primeCache');

            return gsCache.queries.wrap(query1, methods.fetchHandler).then(result => {
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

            return gsCache.queries.wrap(query1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result[0].name).equal(queryRes[0].name);
            });
        });

        it('should get query from cache (2)', () => {
            gsCache.config.global = false;
            cacheManager.set(queryToString(query1), queryRes);

            return gsCache.queries.wrap(query1, { cache: true }, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result[0].name).equal(queryRes[0].name);
            });
        });

        it('should *not* get query from cache (1)', () => {
            cacheManager.set(queryToString(query1), queryRes);
            gsCache.config.global = false;

            return gsCache.queries.wrap(query1, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should *not* get query from cache (2)', () => {
            cacheManager.set(queryToString(query1), queryRes);

            return gsCache.queries.wrap(query1, { cache: false }, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should *not* get query from cache (3)', () => {
            cacheManager.set(queryToString(query1), queryRes);

            // When ttl is set to "-1" don't cache
            const copyConfig = gsCache.config.ttl;
            gsCache.config.ttl = Object.assign({}, gsCache.config.ttl, { queries: -1 });

            return gsCache.queries.wrap(query1, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
                gsCache.config.ttl = copyConfig;
            });
        });

        it('should prime the cache after fetch', () => {
            methods.fetchHandler.restore();
            sinon.stub(methods, 'fetchHandler').resolves(queryRes);

            return gsCache.queries.wrap(query1, methods.fetchHandler).then(() =>
                gsCache.cacheManager.get(queryToString(query1)).then(result => {
                    expect(result[0].name).equal(queryRes[0].name);
                })
            );
        });

        it('should get query from *default* fetchHandler', () => {
            sinon.stub(query1, 'run').resolves(queryRes);

            return gsCache.queries.wrap(query1, { cache: true }).then(result => {
                expect(query1.run.called).equal(true);
                expect(result[0].name).equal(queryRes[0].name);

                return cacheManager.get(queryToString(query1)).then(cacheResponse => {
                    expect(cacheResponse[0].name).equal(queryRes[0].name);
                });
            });
        });

        it('should set the TTL from config', () => {
            methods.fetchHandler.restore();
            sinon.spy(gsCache.cacheManager, 'mset');
            sinon.stub(methods, 'fetchHandler').resolves(queryRes);

            return gsCache.queries.wrap(query1, methods.fetchHandler).then(() => {
                assert.ok(gsCache.cacheManager.mset.called);
                const { args } = gsCache.cacheManager.mset.getCall(0);
                expect(args[2].ttl).equal(5);
                gsCache.cacheManager.mset.restore();
            });
        });

        it('should set ttl dynamically when multistore', done => {
            const memoryCache = StoreMock();
            const redisCache = StoreMock('redis');

            gsCache = gstoreCache.init({
                config: {
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
                },
            });

            const onReady = () => {
                gsCache.removeAllListeners();

                sinon.spy(gsCache.cacheManager, 'mset');
                sinon.spy(memoryCache.store, 'set');
                sinon.spy(redisCache.store, 'set');

                return gsCache.queries.wrap(query1, methods.fetchHandler).then(() => {
                    const options = gsCache.cacheManager.mset.getCall(0).args[2];
                    const optMemory = memoryCache.store.set.getCall(0).args[2];
                    const optRedis = redisCache.store.set.getCall(0).args[2];

                    expect(typeof options.ttl).equal('function');
                    expect(optMemory.ttl).equal(1357);
                    expect(optRedis.ttl).equal(2468);

                    gsCache.deleteCacheManager(() => {
                        memoryCache.store.set.restore();
                        redisCache.store.set.restore();
                        done();
                    });
                });
            };

            gsCache.on('ready', onReady);
        });

        it('should buble up the error from the fetch (1)', done => {
            const error = new Error('Houston we got an error');
            methods.fetchHandler.restore();
            sinon.stub(methods, 'fetchHandler').rejects(error);

            gsCache.queries.wrap(query1, methods.fetchHandler).catch(err => {
                expect(err.message).equal('Houston we got an error');
                done();
            });
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

            it('should not prime the cache and save the query in its entity Kind Set', done => {
                cache = StoreMock('redis');

                gsCache = gstoreCache.init({
                    config: {
                        stores: [cache],
                        ttl: {
                            stores: { redis: { queries: 0 } }, // when set to "0" triggers infinite cache
                        },
                    },
                });

                const onReady = () => {
                    const queryKey = queryToString(query1);

                    methods.fetchHandler.restore();
                    sinon.stub(methods, 'fetchHandler').resolves(queryRes);

                    gsCache.queries.wrap(query1, methods.fetchHandler).then(result => {
                        expect(gsCache.primeCache.called).equal(false);
                        expect(gsCache.queries.cacheQueryEntityKind.called).equal(true);

                        const { args } = gsCache.queries.cacheQueryEntityKind.getCall(0);
                        expect(args[0]).equal(queryKey);
                        expect(args[1]).equal(queryRes);
                        expect(args[2]).equal('Company');
                        expect(result).equal(queryRes);
                        done();
                    });

                    gsCache.removeAllListeners();
                };
                gsCache.on('ready', onReady);
            });

            it('should still prime the cache and *not** save query for Entity Kind', done => {
                cache = StoreMock('redis');

                gsCache = gstoreCache.init({
                    config: {
                        stores: [cache],
                        ttl: {
                            stores: { redis: { queries: 10 } }, // when set to "0" triggers infinite cache
                        },
                    },
                });

                const onReady = () => {
                    methods.fetchHandler.restore();
                    sinon.stub(methods, 'fetchHandler').resolves(queryRes);

                    gsCache.queries.wrap(query1, methods.fetchHandler).then(() => {
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

    describe('get()', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init();
            queryRes = [{ name: string.random() }];

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
                    expect(res).equal(queryRes);
                })
            ));

        it('should get multiple queries from cache', () => {
            const queryRes2 = [{ name: string.random() }];
            return gsCache.queries.mset(query1, queryRes, query2, queryRes2).then(() =>
                gsCache.queries.mget(query1, query2).then(res => {
                    expect(res[0]).equal(queryRes);
                    expect(res[1]).equal(queryRes2);
                })
            );
        });
    });

    describe('set()', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init();
            queryRes = [{ name: string.random() }];

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
            gsCache.set.restore();
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
    });

    describe('mset()', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init();
            queryRes = [{ name: string.random() }];

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
            const queryRes2 = [{ name: string.random() }];
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
            const queryRes2 = [{ name: string.random() }];
            return gsCache.queries.set(query1, queryRes, query2, queryRes2).then(() => {
                const { args } = gsCache.mset.getCall(0);
                expect(args[4].ttl).equal(5);
            });
        });
    });

    describe('del()', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init();
            queryRes = [{ name: string.random() }];

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

    describe('cacheQueryEntityKind', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(done => {
            gsCache = gstoreCache.init({
                config: {
                    stores: [StoreMock('redis')],
                },
            });
            queryRes = [{ name: string.random() }];
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

            return gsCache.queries.cacheQueryEntityKind(queryKey, queryRes, 'User').then(() => {
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

            return gsCache.queries.cacheQueryEntityKind(queryKey, queryRes, 'User', 'Task', 'Post').then(() => {
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

    describe('cleanQueriesEntityKind', () => {
        const gstoreCache = requireUncached('../lib');

        beforeEach(ready => {
            gsCache = gstoreCache.init({
                config: {
                    stores: [StoreMock('redis')],
                },
            });
            queryRes = [{ name: string.random() }];
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
            sinon.stub(redisClient, 'smembers').callsFake((key, cb) => {
                cb(null, ['abc', 'def']);
            });
            sinon.stub(redisClient, 'del').callsFake((keys, cb) => cb(null, 7));

            return gsCache.queries.cleanQueriesEntityKind('User').then(res => {
                assert.ok(redisClient.smembers.called);
                assert.ok(redisClient.del.called);
                const { args: argsSmembers } = redisClient.smembers.getCall(0);
                const { args: argsDel } = redisClient.del.getCall(0);

                const setQueries = `${prefix}User`;
                expect(argsSmembers[0]).equal(setQueries);
                expect(argsDel[0]).include.members(['abc', 'def', setQueries]);
                expect(res).equal(7);

                redisClient.smembers.restore();
                redisClient.del.restore();
            });
        });

        it('should bubble up errors from "smembers" call', done => {
            const error = new Error('Houston we really got a problem');
            sinon.stub(redisClient, 'smembers').callsFake((key, cb) => {
                cb(error);
            });

            gsCache.queries.cleanQueriesEntityKind('User').catch(err => {
                expect(err).equal(error);

                redisClient.smembers.restore();
                done();
            });
        });

        it('should bubble up errors from "del" call', done => {
            const error = new Error('Houston we really got a problem');
            sinon.stub(redisClient, 'del').callsFake((key, cb) => {
                cb(error);
            });

            gsCache.queries.cleanQueriesEntityKind('User').catch(err => {
                expect(err).equal(error);
                done();
            });
        });
    });
});
