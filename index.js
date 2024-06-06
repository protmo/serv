const express = require('express');
const multer = require('multer');
const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const session = require('express-session');
const imageminPngquant = require('imagemin-pngquant');
const { minify } = require('html-minifier');

const app = express();
const port = 3000;

let imagemin;
(async () => {
  const imageminModule = await import('imagemin');
  imagemin = imageminModule.default;
})();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
}));

app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, '/uploads/');
const upload = multer({ dest: uploadDir });

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.set('view engine', 'ejs');

app.get('/', (req, res) => {
  res.render('home');
});

app.get('/upload-html', (req, res) => {
  res.render('upload-html');
});

app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    let imagePath = req.file.path;
    let image = await Jimp.read(imagePath);
    let width = image.bitmap.width;
    let height = image.bitmap.height;

    for (let y = height - 4; y < height; y++) {
      for (let x = 0; x < width; x++) {
        image.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 0), x, y);
      }
    }

    let newName = path.join(uploadDir, 'modified_' + req.file.originalname);
    await image.writeAsync(newName);

    fs.unlinkSync(imagePath);

    if (imagemin) {
      await imagemin([newName], {
        destination: uploadDir,
        plugins: [
          imageminPngquant({ quality: [0.6, 0.8] })
        ]
      });
    }

    res.redirect('/download/' + path.basename(newName));
  } catch (err) {
    console.error("An error occurred:", err);
    res.sendStatus(500);
  }
});

app.get('/download/:filename', (req, res) => {
  let file = path.join(uploadDir, req.params.filename);
  res.download(file, (err) => {
    if (err) {
      console.log(err);
      res.sendStatus(500);
    } else {
      fs.unlinkSync(file);
    }
  });
});

app.get('/parser', (req, res) => {
  res.render('parser');
});

app.post('/check', async (req, res) => {
  const url = req.body.url;

  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const linkData = [];
    $('a').each((index, element) => {
      const link = $(element).attr('href');
      if (link) {
        const decodedLink = decodeURIComponent(link);
        const utmCampaign = (decodedLink.match(/utm_campaign=([^&]*)/) || [])[1];
        const utmContent = (decodedLink.match(/utm_content=([^&]*)/) || [])[1];
        const utmMatch = utmCampaign && utmContent && utmCampaign === utmContent;

        const highlightedLink = utmMatch ? decodedLink.replace(new RegExp(utmCampaign, 'g'), `<mark>${utmCampaign}</mark>`) : decodedLink;

        linkData.push({
          original: link,
          decoded: highlightedLink,
          index: index
        });
      }
    });

    req.session.linkData = linkData; 
    res.render('results', { linkData: linkData });
  } catch (error) {
    console.error(`An error occurred: ${error}`);
    res.sendStatus(500);
  }
});

app.get('/check-utm', (req, res) => {
  const linkData = req.session.linkData;

  const utmContents = {};
  const utmCampaigns = {};

  linkData.forEach(({ decoded }) => {
    const utmCampaign = (decoded.match(/utm_campaign=([^&]*)/) || [])[1];
    const utmContent = (decoded.match(/utm_content=([^&]*)/) || [])[1];

    if (utmContent) {
      utmContents[utmContent] = (utmContents[utmContent] || 0) + 1;
    }

    if (utmCampaign) {
      utmCampaigns[utmCampaign] = (utmCampaigns[utmCampaign] || 0) + 1;
    }
  });

  const updatedLinkData = linkData.map(({ original, decoded, index }) => {
    const utmCampaign = (decoded.match(/utm_campaign=([^&]*)/) || [])[1];
    const utmContent = (decoded.match(/utm_content=([^&]*)/) || [])[1];

    if (utmContent) {
      const contentColor = utmContents[utmContent] > 1 ? `<span class="highlight">${utmContent}</span>` : utmContent;
      decoded = decoded.replace(new RegExp(utmContent, 'g'), contentColor);
    }

    if (utmCampaign) {
      const campaignColor = utmCampaigns[utmCampaign] > 1 ? `<span class="highlight">${utmCampaign}</span>` : utmCampaign;
      decoded = decoded.replace(new RegExp(utmCampaign, 'g'), campaignColor);
    }

    return { original, decoded, index };
  });

  res.render('results', { linkData: updatedLinkData });
});

const htmlFilePath = './uploaded.html';

app.post('/compress', (req, res) => {
  fs.readFile(htmlFilePath, 'utf-8', (err, html) => {
    if (err) {
      console.error(err);
      res.sendStatus(500);
      return;
    }

    const options = {
      collapseWhitespace: true,
      keepClosingSlash: true,
      preserveLineBreaks: true,
      trimCustomFragments: true,
      ignoreCustomFragments: [/<!--[\s\S]*?-->/],
    };

    try {
      const compressedHtml = minify(html, options);
      res.set('Content-Disposition', 'attachment; filename="compressed.html"');
      res.send(compressedHtml);
    } catch (error) {
      console.error(error);
      res.sendStatus(500);
    }
  });
});

app.get('/process', function(req, res) {
  res.render('process');
});

app.get('/sms', function(req, res) {
  res.render('sms');
});

app.listen(3000, () => {
  console.log(`Сервер запущен на порту ${port}`);
});
