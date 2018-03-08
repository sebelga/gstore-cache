'use strict';

const { argv } = require('yargs');

const Datastore = require('@google-cloud/datastore');
const chai = require('chai');
const sinon = require('sinon');
const requireUncached = require('require-uncached');

const gstoreCache = requireUncached('../../lib');

const ds = new Datastore({ projectId: 'gstore-cache-integration-tests' });

const { expect, assert } = chai;

const key1 = ds.key(['User', 123]);
const key2 = ds.key(['User', 456]);
const key3 = ds.key(['User', 789]);
const allKeys = [key1, key2, key3];

const data1 = { name: 'John Snow' };
const data2 = { name: 'Mick Jagger' };
const { k1, k2, k3, k4, user1, user2, query, query2, post1, post2 } = require('./data');

const cleanUp = cb => {
    ds.delete(allKeys).then(cb);
};

describe('Integration Tests (Datastore & Memory cache)', () => {
    let cache;

    beforeEach(function integrationTest(done) {
        if (argv.e2e !== true) {
            // Skip e2e tests suite
            this.skip();
        }

        cache = gstoreCache.init({ datastore: ds });
        const onReady = () => {
            done();
        };
        cache.on('ready', onReady);
    });

    afterEach(done => {
        cache.removeAllListeners();
        cleanUp(() => done());
    });

    it('check that Local Datastore is up and running', () =>
        ds.get(key1).then(res => {
            expect(typeof res[0]).equal('undefined');

            return ds
                .save({ key: key1, data: data1 })
                .then(() => ds.get(key1))
                .then(res2 => {
                    expect(res2[0]).deep.equal(data1);
                });
        }));

    describe('gstoreCache.keys', () => {
        beforeEach(function TestGstoreCacheKeys() {
            if (argv.e2e !== true) {
                // Skip e2e tests suite
                this.skip();
            }
            sinon.spy(ds, 'get');
        });

        afterEach(() => {
            ds.get.restore();
        });

        describe('set()', () => {
            it('should add data to cache', () =>
                ds.save({ key: key1, data: data1 }).then(() =>
                    cache.keys.get(key1).then(result1 => {
                        assert.isUndefined(result1); // make sure the cache is empty
                        return ds
                            .get(key1)
                            .then(result2 => cache.keys.set(key1, result2[0]))
                            .then(() => cache.keys.get(key1))
                            .then(result3 => {
                                expect(result3).deep.equal(data1);
                            });
                    })
                ));

            it('should set multiple keys in cache and return saved values', () =>
                cache.keys.mset(key1, data1, key2, data2).then(result => {
                    expect(result[0]).equal(data1);
                    expect(result[1]).equal(data2);
                }));

            it('should set the key in the cache', () =>
                cache.keys
                    .get(key1)
                    .then(result => {
                        assert.isUndefined(result);
                    })
                    .then(() => cache.keys.set(key1, data1))
                    .then(() => cache.keys.read(key1))
                    .then(result => {
                        expect(result).contains(data1);
                        expect(ds.get.called).equal(false);
                    })
                    .then(() => cache.keys.get(key1))
                    .then(result => {
                        expect(result).contains(data1);
                        expect(result[ds.KEY]).equal(key1);
                    }));
        });

        describe('read()', () => {
            it('should add data to cache', () =>
                ds.save({ key: key1, data: data1 }).then(() =>
                    cache.keys
                        .read(key1)
                        .then(result => {
                            expect(result).deep.equal(data1);
                        })
                        .then(() =>
                            cache.keys.read(key1).then(result => {
                                expect(result).deep.equal(data1);
                                expect(result[ds.KEY]).equal(key1);
                                expect(ds.get.callCount).equal(1);
                            })
                        )
                ));

            it('should allow multiple keys', () =>
                ds.save([{ key: key1, data: data1 }, { key: key2, data: data2 }]).then(() =>
                    cache.keys
                        .read([key1, key2])
                        .then(result => {
                            expect(result[0]).deep.equal(data1);
                            expect(result[1]).deep.equal(data2);
                        })
                        .then(() =>
                            cache.keys.read([key1, key2]).then(result => {
                                expect(result[0]).deep.equal(data1);
                                expect(result[1]).deep.equal(data2);
                                expect(result[0][ds.KEY]).equal(key1);
                                expect(result[1][ds.KEY]).equal(key2);
                                expect(ds.get.callCount).equal(1);
                            })
                        )
                ));

            it('should return undefined when Key not found', () =>
                cache.keys.read(key1).then(result => {
                    assert.isUndefined(result);
                }));
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
            it('should add query data to cache', () =>
                cache.queries.get(query).then(result1 => {
                    assert.isUndefined(result1); // make sure the cache is empty
                    return query
                        .run()
                        .then(result2 => cache.queries.set(query, result2))
                        .then(() => cache.queries.get(query))
                        .then(result3 => {
                            const [entities] = result3;
                            expect(entities).deep.equal([user1, user2]);
                        });
                }));
        });

        describe('mget() & mset()', () => {
            it('should set and return multiple queries', () =>
                cache.queries.mget(query, query2).then(result1 => {
                    assert.isUndefined(result1[0]);
                    assert.isUndefined(result1[1]);
                    return Promise.all([query.run(), query2.run()])
                        .then(result2 => cache.queries.mset(query, result2[0], query2, result2[1]))
                        .then(() => cache.queries.mget(query, query2))
                        .then(result3 => {
                            const [users] = result3[0];
                            const [posts] = result3[1];
                            expect(users).deep.equal([user1, user2]);
                            expect(posts).deep.equal([post1, post2]);
                        });
                }));
        });
    });
});
