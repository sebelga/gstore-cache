'use strict';

const Datastore = require('@google-cloud/datastore');
const chai = require('chai');
const sinon = require('sinon');
const requireUncached = require('require-uncached');
const redisStore = require('cache-manager-redis-store');
const { argv } = require('yargs');

const gstoreCache = requireUncached('../../lib');
const { datastore } = require('../../lib/utils');

const ds = new Datastore({ projectId: 'gstore-cache-e2e-tests' });

const { expect, assert } = chai;

const key1 = ds.key(['User', 123]);
const key2 = ds.key(['User', 456]);
const key3 = ds.key(['User', 789]);
const allKeys = [key1, key2, key3];

const { k1, k2, k3, k4, user1, user2, query, query2, post1, post2 } = require('./data');

const cleanUp = cb => {
    ds.delete(allKeys).then(cb);
};

describe('Integration Tests (Datastore & Memory + Redis cache)', () => {
    let cache;
    let redisClient;
    let queryToString;

    beforeEach(function integrationTest(done) {
        if (argv.e2e !== true) {
            // Skip e2e tests suite
            this.skip();
        }

        cache = gstoreCache.init({
            config: {
                stores: [{ store: 'memory' }, { store: redisStore }],
            },
            datastore: ds,
        });
        const onReady = () => {
            const prefix = cache.config.cachePrefix.queries;
            queryToString = q => prefix + datastore.dsQueryToString(q);
            redisClient = cache.config.stores[1].store.getClient();
            done();
        };
        cache.on('ready', onReady);
    });

    afterEach(done => {
        cache.removeAllListeners();
        cache.deleteCacheManager(() => {
            cleanUp(() => done());
        });
    });

    describe('gstoreCache.keys', () => {
        beforeEach(function TestGstoreCacheQueries(done) {
            if (argv.e2e !== true) {
                // Skip e2e tests suite
                this.skip();
            }
            ds.save([{ key: k1, data: user1 }, { key: k2, data: user2 }]).then(() => done());
        });

        it('should add the entities to cache', () => {
            const { store } = cache.config.stores[1];
            sinon.spy(store, 'mset');
            return ds.get([k1, k2]).then(([entities]) =>
                cache.keys
                    .mset(k1, entities[0], k2, entities[1], { ttl: { memory: 1122, redis: 3344 } })
                    .then(result => {
                        const { args } = store.mset.getCall(0);
                        expect(args[4].ttl).equal(3344);

                        expect(result[0]).deep.equal(user1);
                        expect(result[1]).deep.equal(user2);
                    })
            );
        });
    });

    describe('gstoreCache.queries', () => {
        beforeEach(function TestGstoreCacheQueries(done) {
            if (argv.e2e !== true) {
                // Skip e2e tests suite
                this.skip();
            }
            Promise.all([
                ds.save([{ key: k1, data: user1 }, { key: k2, data: user2 }]),
                ds.save([{ key: k3, data: post1 }, { key: k4, data: post2 }]),
            ]).then(() => done());
        });

        describe('set()', () => {
            it('should add query data to Redis Cache + EntityKind Set', () => {
                sinon.spy(redisClient, 'multi');

                return cache.queries.get(query).then(result1 => {
                    assert.isUndefined(result1); // make sure the cache is empty
                    return query
                        .run()
                        .then(result2 => cache.queries.set(query, result2, { ttl: { memory: 1122, redis: 3344 } }))
                        .then(() => {
                            const args = redisClient.multi.getCall(0).args[0];
                            expect(args[1]).contains('setex');
                            expect(args[1]).contains(3344);
                            redisClient.multi.restore();

                            return new Promise((resolve, reject) => {
                                redisClient.get(queryToString(query), (err, data) => {
                                    if (err) {
                                        return reject(err);
                                    }
                                    const response = JSON.parse(data);
                                    const [entities] = response;
                                    expect(entities[0]).contains(user1);
                                    expect(entities[1]).contains(user2);

                                    // Make sure we saved the KEY Symbol
                                    assert.isDefined(entities[0].__dsKey__);
                                    assert.isDefined(entities[1].__dsKey__);
                                    return resolve();
                                });
                            });
                        })
                        .then(() =>
                            cache.queries.get(query).then(response => {
                                const [entities] = response;
                                // Make sure we put back from the Cache the Symbol
                                assert.isDefined(entities[0][ds.KEY]);
                                assert.isDefined(entities[1][ds.KEY]);
                                expect(entities[0][ds.KEY].id).equal('222');
                                expect(entities[1][ds.KEY].id).equal('333');
                            })
                        )
                        .then(
                            () =>
                                new Promise((resolve, reject) => {
                                    redisClient.scard('gcq:User', (err, total) => {
                                        if (err) {
                                            return reject(err);
                                        }
                                        expect(total).equal(1);
                                        return resolve();
                                    });
                                })
                        );
                });
            });
        });

        describe('mget() & mset()', () => {
            it('should set and return multiple queries', () =>
                cache.queries.mget(query, query2).then(result1 => {
                    assert.isUndefined(result1[0]);
                    assert.isUndefined(result1[1]);

                    let resQuery1;
                    let resQuery2;

                    return Promise.all([query.run(), query2.run()])
                        .then(result2 => {
                            [resQuery1, resQuery2] = result2;
                            return cache.queries.mset(query, resQuery1, query2, resQuery2, { ttl: 600 });
                        })
                        .then(result3 => {
                            expect(result3[0]).deep.equal(resQuery1);
                            expect(result3[1]).deep.equal(resQuery2);

                            return cache.queries.mget(query, query2);
                        })
                        .then(result4 => {
                            const [users] = result4[0];
                            const [posts] = result4[1];
                            expect(users).deep.equal([user1, user2]);
                            expect(posts).deep.equal([post1, post2]);
                        });
                }));
        });

        describe('read()', () => {
            it('should add query data to Redis Cache + EntityKind Set', () =>
                cache.queries.get(query).then(result1 => {
                    assert.isUndefined(result1); // make sure the cache is empty
                    return cache.queries
                        .read(query)
                        .then(response => {
                            const [entities] = response;
                            assert.isDefined(entities[0][ds.KEY]);
                            assert.isDefined(entities[1][ds.KEY]);
                        })
                        .then(
                            () =>
                                new Promise((resolve, reject) => {
                                    redisClient.get(queryToString(query), (err, data) => {
                                        if (err) {
                                            return reject(err);
                                        }
                                        const response = JSON.parse(data);
                                        const [entities, meta] = response;
                                        expect(entities[0]).contains(user1);
                                        expect(entities[1]).contains(user2);
                                        assert.isDefined(meta.endCursor);

                                        // Make sure we saved the KEY Symbol
                                        assert.isDefined(entities[0].__dsKey__);
                                        assert.isDefined(entities[1].__dsKey__);
                                        return resolve();
                                    });
                                })
                        )
                        .then(() =>
                            cache.queries.get(query).then(response => {
                                const [entities] = response;
                                // Make sure we put back from the Cache the Symbol
                                assert.isDefined(entities[0][ds.KEY]);
                                assert.isDefined(entities[1][ds.KEY]);
                                expect(entities[0][ds.KEY].id).equal('222');
                                expect(entities[1][ds.KEY].id).equal('333');
                            })
                        )
                        .then(
                            () =>
                                new Promise((resolve, reject) => {
                                    redisClient.scard('gcq:User', (err, total) => {
                                        if (err) {
                                            return reject(err);
                                        }
                                        expect(total).equal(1);
                                        return resolve();
                                    });
                                })
                        );
                }));
        });

        describe('kset()', () => {
            const queryKey = 'my-query-key';
            const queryData = [{ id: 1, title: 'Post title', author: { name: 'John Snow' } }];

            it('should add query data to Redis Cache with multiple Entity Kinds', () =>
                cache.get(queryKey).then(result1 => {
                    assert.isUndefined(result1); // make sure the cache is empty
                    return cache.queries
                        .kset(queryKey, queryData, ['Post', 'Author'])
                        .then(
                            () =>
                                new Promise((resolve, reject) => {
                                    redisClient.get(queryKey, (err, data) => {
                                        if (err) {
                                            return reject(err);
                                        }
                                        return resolve(JSON.parse(data));
                                    });
                                })
                        )
                        .then(result2 => {
                            expect(result2).deep.equal(queryData);
                        })
                        .then(
                            () =>
                                new Promise((resolve, reject) => {
                                    redisClient.scard('gcq:Post', (err, total) => {
                                        if (err) {
                                            return reject(err);
                                        }
                                        expect(total).equal(1);
                                        return resolve();
                                    });
                                })
                        )
                        .then(
                            () =>
                                new Promise((resolve, reject) => {
                                    redisClient.scard('gcq:Author', (err, total) => {
                                        if (err) {
                                            return reject(err);
                                        }
                                        expect(total).equal(1);
                                        return resolve();
                                    });
                                })
                        );
                }));
        });

        describe('clearQueriesEntityKind()', () => {
            it('should delete cache and remove from EntityKind Set', () =>
                cache.queries.get(query).then(result1 => {
                    assert.isUndefined(result1); // make sure the cache is empty
                    return query
                        .run()
                        .then(result2 => cache.queries.set(query, result2))
                        .then(() => cache.queries.clearQueriesEntityKind('User'))
                        .then(
                            () =>
                                // Check that Query Cache does not exist anymore
                                new Promise((resolve, reject) => {
                                    redisClient.get(queryToString(query), (err, data) => {
                                        if (err) {
                                            return reject(err);
                                        }
                                        expect(data).equal(null);
                                        return resolve();
                                    });
                                })
                        )
                        .then(
                            () =>
                                // Check that the Set does not contains any more Queries
                                new Promise((resolve, reject) => {
                                    redisClient.scard('gcq:User', (err, total) => {
                                        if (err) {
                                            return reject(err);
                                        }
                                        expect(total).equal(0);
                                        return resolve();
                                    });
                                })
                        );
                }));

            it('should delete cache and remove from multiple EntityKind Set', () => {
                const queryKey = 'my-query-key';
                const queryData = [{ id: 1, title: 'Post title', author: { name: 'John Snow' } }];

                return cache.get(queryKey).then(result1 => {
                    assert.isUndefined(result1); // make sure the cache is empty
                    return cache.queries
                        .kset(queryKey, queryData, ['Post', 'Author'])
                        .then(
                            () =>
                                new Promise((resolve, reject) => {
                                    redisClient
                                        .multi([['get', queryKey], ['scard', 'gcq:Post'], ['scard', 'gcq:Author']])
                                        .exec((err, response) => {
                                            if (err) {
                                                return reject(err);
                                            }
                                            expect(JSON.parse(response[0])).deep.equal(queryData);
                                            expect(response[1]).equal(1);
                                            expect(response[2]).equal(1);
                                            return resolve();
                                        });
                                })
                        )
                        .then(() => cache.queries.clearQueriesEntityKind(['Post', 'Author']))
                        .then(
                            () =>
                                new Promise((resolve, reject) => {
                                    redisClient
                                        .multi([['get', queryKey], ['scard', 'gcq:Post'], ['scard', 'gcq:Author']])
                                        .exec((err, response) => {
                                            if (err) {
                                                return reject(err);
                                            }
                                            expect(response[0]).equal(null);
                                            expect(response[1]).equal(0);
                                            expect(response[2]).equal(0);
                                            return resolve();
                                        });
                                })
                        );
                });
            });
        });
    });
});
