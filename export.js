var Promise = require('bluebird');
var cassandra = require('cassandra-driver');
var fs = require('fs');
var jsonStream = require('JSONStream');

var HOST = process.env.HOST || '127.0.0.1';
var KEYSPACE = process.env.KEYSPACE;

if (!KEYSPACE) {
    console.log('`KEYSPACE` must be specified as environment variable');
    process.exit();
}

var systemClient = new cassandra.Client({contactPoints: [HOST]});
var client = new cassandra.Client({ contactPoints: [HOST], keyspace: KEYSPACE});

function processTableExport(table) {
    console.log('==================================================');
    console.log('Reading table: ' + table);
    return new Promise(function(resolve, reject) {
        var jsonfile = fs.createWriteStream('data/' + table + '.json');
        jsonfile.on('error', function (err) {
            reject(err);
        });

        var processed = 0;
        var startTime = Date.now();
        jsonfile.on('finish', function () {
            var timeTaken = (Date.now() - startTime) / 1000;
            var throughput = processed / timeTaken;
            console.log('Done with table, throughput: ' + throughput.toFixed(1) + ' rows/s');
            resolve();
        });
        var writeStream = jsonStream.stringify('[', ',', ']');
        writeStream.pipe(jsonfile);

        var query = 'SELECT * FROM "' + table + '"';
        var options = { prepare : true , fetchSize : 1000 };

        client.eachRow(query, [], options, function (n, row) {
            var rowObject = {};
            row.forEach(function(value, key){
                rowObject[key] = value;
            });
            processed++;
            writeStream.write(rowObject);
        }, function (err, result) {

            if (err) {
                reject(err);
                return;
            }

            console.log('Streaming ' + processed + ' rows to: ' + table + '.json');

            if (result.nextPage) {
                result.nextPage();
                return;
            }

            console.log('Finalizing writes into: ' + table + '.json');
            writeStream.end();
        });
    });
}

systemClient.connect()
    .then(function (){
        var systemQuery = "SELECT columnfamily_name as table_name FROM system.schema_columnfamilies WHERE keyspace_name = ?";
        if (systemClient.metadata.keyspaces.system_schema) {
            systemQuery = "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?";
        }

        console.log('Finding tables in keyspace: ' + KEYSPACE);
        return systemClient.execute(systemQuery, [KEYSPACE]);
    })
    .then(function (result){
        var tables = [];
        for(var i = 0; i < result.rows.length; i++) {
            tables.push(result.rows[i].table_name);
        }

        if (process.env.TABLE) {
            return processTableExport(process.env.TABLE);
        }

        return Promise.each(tables, function(table){
            return processTableExport(table);
        });
    })
    .then(function (){
        console.log('==================================================');
        console.log('Completed exporting all tables from keyspace: ' + KEYSPACE);
        systemClient.shutdown();
        client.shutdown();
    })
    .catch(function (err){
        console.log(err);
    });
