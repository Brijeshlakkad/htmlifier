const express = require('express');
const ptr = require('puppeteer');
const util = require('util');
const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const path = require('path');
// const morgan = require('morgan');
const dotenv = require('dotenv');
const fs = require('fs');
const {exec} = require('child_process');
const cors = require('cors');
// const firebase = require('firebase');

const admin = require('firebase-admin');
const uuid = require('uuid-v4');
const serviceAccount = require('./credentials.json');

const uniqid = require('uniqid');

const app = express();
const async_exec = util.promisify(exec);

app.use(cors());
app.use(fileUpload({
    createParentPath: true
}));
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(express.static('./public/'));
app.use(express.json({limit: '1mb'}));
// app.use(morgan('dev'));  

dotenv.config();

global.XMLHttpRequest = require("xhr2");

const port = process.env.PORT || 8282;

// const firebaseConfig = {
//     apiKey: process.env.apiKey,
//     authDomain: process.env.authDomain,
//     databaseURL: process.env.databaseURL,
//     projectId: process.env.projectId,
//     storageBucket: process.env.storageBucket,
//     messagingSenderId: process.env.messagingSenderId,
//     appId: process.env.appId
// };

// firebase.initializeApp(firebaseConfig);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.storageBucket
})

const bucket = admin.storage().bucket();
const store = admin.firestore();

const convertSb3ToHtml = (directoryName, filename) => {
    return new Promise(async (resolve, reject) => {
        try {
            let launchOptions = {headless: false, args: ['--start-maximized']};
            const browser = await ptr.launch(launchOptions);
            const page = await browser.newPage();
            await page.setViewport({width: 1366, height: 768});
            // await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');
            await page._client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: `/home/ashish/APK/${directoryName}/`})
            const p = path.join(__dirname, '/htmlifier-resources/index.html');
            await page.goto(`file://${p}`);
            await page.waitForSelector('input[type=file]');
            await page.waitFor(1000);
            const inputUploadHandle = await page.$('input[type=file]');
            let fileToUpload = `/home/ashish/APK/${directoryName}/${filename}.sb3`;
            inputUploadHandle.uploadFile(fileToUpload);
            await page.waitFor(500);
            await page.$eval('#title', el => el.value = 'index');
            await (await page.waitForSelector('#load-no-minify')).click();
            // setTimeout(async () => {
            //     browser.close().then(() => {
            //         resolve(true);
            //     }).catch((err) => {
            //         console.log(err);
            //         reject(false);
            //     });
            // }, 2000);
        } catch (err) {
            console.log(err);
            reject(false);
        }
    })
}

const commandLineInstruction = (cmdToExecute, path) => {
    return new Promise((resolve, reject) => {
        async_exec(cmdToExecute, {cwd: path}, (error, stdout, stderr) => {
            console.log(cmdToExecute);
            if (error) {
                console.log('error:', error);
                reject(false);
            }
            if (stderr) {
                console.log('stderr: ', stderr);
                reject(false);
            }
            console.log(stdout);
            resolve(true);
        });
    })
}

const convertSb3ToApk = (directoryName, filename) => {
    return new Promise (async (resolve, reject) => {
        const status = await convertSb3ToHtml(directoryName, filename);
        console.log(status);
        if (status) {
            try {
                await commandLineInstruction(`cordova create ${filename}  com.example.${filename} ${filename}`, `/home/ashish/APK/${directoryName}/`);
                await commandLineInstruction(`mv /home/ashish/APK/${directoryName}/index.html /home/ashish/APK/${directoryName}/${filename}/www/`, '.');
                await commandLineInstruction('cordova platform add android', `/home/ashish/APK/${directoryName}/${filename}`);
                await commandLineInstruction('cordova build', `/home/ashish/APK/${directoryName}/${filename}`).then(() => {
                    resolve(`/home/ashish/APK/${directoryName}/${filename}/platforms/android/app/build/outputs/ashish/debug/app-debug.apk`); //apk path
                });
            } catch (err) {
                reject(err);
            }
        } else {
            reject('error');
        }
    })
}

const cleanup = (directoryName) => {
    return new Promise(async (resolve, reject) => {
        try {
            // await commandLineInstruction(`rm ./temp/${filename}.sb3`, '.');
            // await commandLineInstruction(`rm -rf ./temp/${filename}`, '.');
            await commandLineInstruction(`rm -rf /home/ashish/APK/${directoryName}`, '.')
            resolve(true);
        } catch {
            reject(false);
        }
    })
}

app.get('/api/v1/testApk', async (req, res) => {
    // res.download('./temp/chart/platforms/android/app/build/outputs/apk/debug/app-debug.apk');
    let launchOptions = {headless: true, args: ['--no-sandbox']}
    const browser = await ptr.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({width: 1366, height: 768});
    await page.goto('https://google.com');
    const dimensions = await page.evaluate(() => {
    return {
            width: document.documentElement.clientWidth,
            height: document.documentElement.clientHeight,
            deviceScaleFactor: window.devicePixelRatio
        };
    });
    
    console.log('Dimensions:', dimensions);
    
    browser.close().then(() => {
        res.send({
            'data': dimensions
        });
    }).catch((err) => {
        console.log(err);
        res.send({
            'data': err
        });
    });
});

app.post("/api/v1/getApk", async (req, res) => {
    const requestId = req.body.rid;
    const uid = req.body.uid;
    let file = req.files['sb3File'];
    let filename = file.name;
    const directoryName = uniqid('apk_');

    filename = filename.split('.')[0].replace(/[\])}[{(] /g, '');
    filename = filename.replace(/\s/g, '_');
    file.mv(`/home/ashish/APK/${directoryName}/` + filename + '.sb3');

    convertSb3ToApk(directoryName, filename).then((path) => {
        
    //     console.log(path);

    //     const metadata = {
    //         metadata: {
    //             // This line is very important. It's to create a download token.
    //             firebaseStorageDownloadtokens: uuid()
    //         },
    //         contentType: 'application/vnd.android.package-archive',
    //     };

    //     bucket.upload(path, {
    //         destination: `user_assets/${uid}/apks/${requestId}/project.apk`,
    //         // Support for HTTP requests made with `Accept-Encoding: gzip`
    //         gzip: true,
    //         metadata: metadata
    //     }).then(async (data) => {
    //         const userApkDoc = await (await store.collection(`user_apk_requests`).doc(uid).get()).data();
    //         const prevBytesSize = userApkDoc['total_byte_size'];
    //         const curBytes = parseInt(data[1]["size"]);
    //         const totalBytes = prevBytesSize + curBytes;
    //         const reqDocRef = store.collection(`user_apk_requests/${uid}/requests/`).doc(requestId);
    //         reqDocRef.update({
    //             status: "SUCCESS",
    //         });
    //         const userRef = store.collection(`user_apk_requests`).doc(uid);
    //         userRef.update({
    //             current_status: "IDLE",
    //              total_byte_size: totalBytes
    //         });
    //         res.send({
    //             status: 200,
    //             'message': 'apk created successfully'
    //         });
    //         cleanup(directoryName).then((val) => {
    //             console.log(val);
    //             // res.send('apk successfully created!');
    //         }).catch((err) => {
    //             console.log(err);
    //         })
    //     }).catch((err) => {
    //         console.log('err: ', err);
    //         const reqDocRef = store.collection(`user_apk_requests/${uid}/requests/`).doc(requestId);
    //         reqDocRef.update({
    //             status: "ERROR",
    //         });
    //         const userRef = store.collection(`user_apk_requests`).doc(uid);
    //         userRef.update({
    //             current_status: "IDLE",
    //         });
    //         res.send({
    //             status: 400,
    //             'message': err
    //         });
    //         cleanup(directoryName).then((val) => {
    //             console.log(val);
    //         }).catch((err) => {
    //             console.log(err);
    //         })
    //     })

    }).catch((err) => {
        console.log(err);
    })
}) 

app.listen(port, () => {
    console.log(`Listening at ${port}`);
});
