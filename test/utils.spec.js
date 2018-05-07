'use strict';

const chai = require('chai');

const utils = require('../lib/utils');
const { keys, queries } = require('./mocks/datastore');

const [query1, query2, query3] = queries;
const [key1, , , , key5] = keys;

const { expect } = chai;
const { dsKeyToString, dsQueryToString } = utils.datastore;

describe('utils', () => {
    describe('dsKeyToString', () => {
        it('should convert the query to string', () => {
            const str1 = dsKeyToString(key1, { hash: false });
            const str2 = dsKeyToString(key5, { hash: false });

            expect(str1).equal('ns:%:User:%:111');
            expect(str2).equal('GranDad:%:John:%:Dad:%:Mick:%:User:%:555');
        });

        it('should throw an error if no Key passed', () => {
            const fn = () => dsKeyToString();
            expect(fn).throws('Key cannot be undefined.');
        });
    });

    describe('dsQueryToString', () => {
        const separator = ':%:';
        it('should convert the query to string', () => {
            const str1 = dsQueryToString(query1, { hash: false });
            const str2 = dsQueryToString(query2, { hash: false });
            const str3 = dsQueryToString(query3, { hash: false });

            expect(str1).equal(
                `Company${separator}com.domain.dev${separator}name=Sympresafield1<123field2>789__key__HAS_ANCESTORParent${separator}123${separator}field1field2${separator}10${separator}5${separator}size-${separator}namesize${separator}X${separator}Y` // eslint-disable-line
            );
            expect(str2).equal(
                `User${separator + separator}name=john${separator +
                    separator}-1${separator}-1${separator}phone+${separator + separator + separator}`
            );
            expect(str3).equal(
                `Task${separator + separator}__key__>Task${separator}someTask${separator +
                    separator}-1${separator}-1${separator + separator}__key__${separator + separator}`
            );
        });
    });
});
