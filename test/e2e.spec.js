'use strict';

const { argv } = require('yargs');

const Datastore = require('@google-cloud/datastore');
const chai = require('chai');
const sinon = require('sinon');
const requireUncached = require('require-uncached');

const gstoreCache = requireUncached('../lib');

const ds = new Datastore({ projectId: 'gstore-cache-e2e-tests' });

const { expect } = chai;

const key1 = ds.key(['User', 123]);
const key2 = ds.key(['User', 456]);
const key3 = ds.key(['User', 789]);
const allKeys = [key1, key2, key3];

const data1 = { name: 'John Snow' };
// const data2 = { name: 'Mick Jagger' };
// const data3 = { name: 'Keith Richards' };

const cleanUp = cb => {
    ds.delete(allKeys).then(() => cb());
};

describe('e2e (Datastore & Redis)', () => {
    let cache;

    beforeEach(function integrationTest(done) {
        if (!argv.e2e === true) {
            this.skip();
        }
        sinon.spy(ds, 'get');

        cache = gstoreCache.init({ datastore: ds });
        const onReady = () => {
            done();
        };
        cache.on('ready', onReady);
    });

    afterEach(done => {
        cache.removeAllListeners();
        ds.get.restore();
        cleanUp(done);
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

    it('should add data to cache', () =>
        ds.save({ key: key1, data: data1 }).then(() =>
            cache.keys.get(key1).then(result1 => {
                expect(typeof result1).equal('undefined'); // make sure the cache is empty
                ds
                    .get(key1)
                    .then(result2 => cache.keys.set(key1, result2[0]))
                    .then(() => cache.keys.get(key1))
                    .then(result3 => {
                        expect(result3).deep.equal(data1);
                    });
            })
        ));

    describe('wrap', () => {
        it('should add data to cache', () =>
            ds.save({ key: key1, data: data1 }).then(() =>
                cache.keys
                    .wrap(key1)
                    .then(result => {
                        expect(result).deep.equal(data1);
                    })
                    .then(() =>
                        cache.keys.wrap(key1).then(result => {
                            expect(result).deep.equal(data1);
                            expect(ds.get.callCount).equal(1);
                        })
                    )
            ));
    });
});
