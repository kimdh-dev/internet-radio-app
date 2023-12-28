const port = 8000;
const express = require('express');
const path = require('path');
const child_process = require("child_process");
const fs = require('fs');
const axios = require('axios');
const mDnsSd = require('node-dns-sd');
const querystring = require('querystring');

// axios
const instance = axios.create({
    timeout: 3000,
});

// express
const app = express();
const apiRouter = express.Router();

let device = null;

async function getkbs(param) {
    let kbs_ch = {
        'kbs_1radio': '21',
        'kbs_3radio': '23',
        'kbs_classic': '24',
        'kbs_cool': '25',
        'kbs_happy': '22'
    };
    try {
        const resp = await instance({
            method: 'get',
            url: 'https://cfpwwwapi.kbs.co.kr/api/v1/landing/live/channel_code/' + kbs_ch[param],
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
                'referer': 'https://onair.kbs.co.kr/'
            }
        });
        const kbs_src = resp.data.channel_item;
        for (let i = 0; i < kbs_src.length; i++) {
            if (kbs_src[i].media_type == 'radio') {
                var media_src = kbs_src[i].service_url;
                break;
            }
        }
        return media_src;
    } catch (e) {
        console.log(e);
        return '1';
    }
}

async function getsbs(ch) {
    let sbs_ch = {
        'sbs_power': ['powerfm', 'powerpc'],
        'sbs_love': ['lovefm', 'lovepc']
    };
    try {
        const resp = await instance({
            method: 'get',
            url: 'https://apis.sbs.co.kr/play-api/1.0/livestream/' + sbs_ch[ch][1] + '/' + sbs_ch[ch][0] + '?protocol=hls&ssl=Y',
            headers: {
                'Host': 'apis.sbs.co.kr',
                'Connection': 'keep-alive',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_16_0) AppleWebKit/537.36 (KHTML, like Gecko) GOREALRA/1.2.1 Chrome/85.0.4183.121 Electron/10.1.3 Safari/537.36',
                'Accept': '*/*',
                'Origin': 'https://gorealraplayer.radio.sbs.co.kr',
                'Sec-Fetch-Site': 'same-site',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
                'Referer': 'https://gorealraplayer.radio.sbs.co.kr/main.html?v=1.2.1',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'ko',
                'If-None-Match': 'W/"134-0OoLHiGF4IrBKYLjJQzxNs0/11M"'
            }
        });
        return resp.data;
    } catch (e) {
        console.log(e);
        return '1';
    }
}

async function getmbc(ch) {
    try {
        let mbc_ch = {
            'mbc_fm4u': 'mfm',
            'mbc_fm': 'sfm',
            'allthat': 'chm'
        };
        const resp = await instance({
            method: 'get',
            url: 'https://sminiplay.imbc.com/aacplay.ashx?agent=webapp&channel=' + mbc_ch[ch] + '&callback=jarvis.miniInfo.loadOnAirComplete',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36',
                'Referer': 'http://mini.imbc.com/',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate'
            }
        });
        const radio_url = 'https://' + resp.data.split('"https://')[1].split('"')[0];
        return radio_url;
    } catch (e) {
        console.log(e);
        return '1';
    }
}

function return_ffmpeg_audio(radio_url, req, res) {
    let ffmpeg_pipe = child_process.spawn("ffmpeg", ["-headers", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Safari/537.36",
        "-loglevel", "error", "-i", radio_url, "-c:a", "mp3", "-b:a", "256k", "-ar", "44100", "-ac", "2", "-bufsize", "64K", "-f", "wav", "pipe:1"
    ], {
        detached: false
    });

    ffmpeg_pipe.stdout.pipe(res);

    ffmpeg_pipe.on('error', (error) => {
        console.error(`${error.message}`);
        if (ffmpeg_pipe) {
            ffmpeg_pipe.kill();
            console.log("ffmpeg kill");
        }
        res.status(500).send('error');
    });

    req.on("close", function () {
        if (ffmpeg_pipe) {
            ffmpeg_pipe.kill();
        }
    });

    req.on("end", function () {
        if (ffmpeg_pipe) {
            ffmpeg_pipe.kill();
        }
    });
}

apiRouter.get('/get_radio_list', (req, res) => {
    const radio_list = JSON.parse(fs.readFileSync('./data/radio-list.json', 'utf8'));
    res.json(radio_list);
});

apiRouter.get('/get_setting', (req, res) => {
    const data = fs.readFileSync('./data/setting.json', 'utf8');
    res.json(JSON.parse(data));
});

apiRouter.post('/save_setting', (req, res) => {
    const payload = req.body;
    const { ip } = payload;
    const setting = JSON.parse(fs.readFileSync('./data/setting.json', 'utf8'));
    setting.ip = ip;
    const setting2 = JSON.stringify(setting);
    fs.writeFile('./data/setting.json', setting2, 'utf8', function (error) { });
    res.json({ 'result': 'success' });
});

apiRouter.get('/discover_google_speaker', (req, res) => {
    mDnsSd.discover({
        name: '_googlecast._tcp.local'
    }).then((device_list) => {
        let lists = device_list;
        let arrList = new Array();
        for (let i = 0; i < lists.length; i++) {
            let p = new Object();
            p.ipaddress = lists[i].address;
            p.friendly = lists[i].familyName;
            arrList.push(p);
        }
        let json = arrList;
        res.json(json);
    }).catch((error) => {
        console.error(error);
    });
});

// play radio
apiRouter.get('/play_radio', async (req, res) => {
    const payload = req.query;
    const { ch } = payload;
    if (ch) {
        const radio_list = JSON.parse(fs.readFileSync('./data/radio-list.json', 'utf8'));
        if (Object.hasOwnProperty.call(radio_list, ch)) {
            const ch_value = radio_list[ch].url;

            let radio_url;

            // 채널: KBS, SBS, MBC
            if (ch_value == 'kbs_lib') {
                radio_url = await getkbs(ch);
            } else if (ch_value == 'sbs_lib') {
                radio_url = await getsbs(ch);
            } else if (ch_value == 'mbc_lib') {
                radio_url = await getmbc(ch);
            } else {
                radio_url = ch_value;
            }

            return_ffmpeg_audio(radio_url, req, res);
        } else {
            res.json({ 'result': 'fail' });
        }
    } else {
        res.json({ 'result': 'fail' });
    }
});

// cast radio
apiRouter.get('/start_cast_radio', (req, res) => {
    const payload = req.query;
    const { ch, stream_ip } = payload;
    if (!ch || !stream_ip) {
        res.json({ 'result': 'fail' });
    }
    const general_list = ['ebsfm', 'cbs_fm', 'cbs_music_fm'];

    let radio_url;

    if (general_list.indexOf(ch) != -1) {
        const radio_list = JSON.parse(fs.readFileSync('./data/radio-list.json', 'utf8'));
        radio_url = radio_list[ch];
    } else {
        radio_url = `${req.protocol}://${req.headers.host}/api/play_radio?ch=${ch}`;
    }

    const Device = require('./lib/device');
    try {
        const opts = { name: 'chromecast', friendlyName: 'Chromecast', host: stream_ip };
        device = new Device(opts);
        const media = {
            url: radio_url,
            cover: {
                title: '인터넷 라디오',
                url: 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg'
            }
        };
        device.play(media);
        res.json({ 'result': 'success' });
    } catch (e) {
        res.json({ 'result': 'fail' });
    }
});

apiRouter.get('/stop_cast_radio', (req, res) => {
    if (device != null) {
        device.pause();
    }
    res.json({ 'result': 'success' });
});

apiRouter.get('/set_cast_volume', (req, res) => {
    const payload = req.query;
    const { volume } = payload;
    if (device != null) {
        device.setVolume(parseFloat(volume));
    }
    res.json({ 'result': 'success' });
});


app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/', express.static(path.join(__dirname, './dist')));
app.use('/api', apiRouter);

app.listen(port, () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});