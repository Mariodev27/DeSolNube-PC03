require('dotenv').config();

const bodyParser = require('body-parser');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

const mysql = require('mysql2');
const connection = mysql.createConnection(process.env.DATABASE_URL);

connection.connect();

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Límite de tamaño del archivo (10 MB en este ejemplo)
});

app.set('view engine', 'ejs');

const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/fotos', express.static(path.join(__dirname, 'public', 'fotos')));


app.get('/', (req, res) => {
  connection.query('SELECT * FROM estudiantes', (error, results, fields) => {
    if (error) throw error;
    res.render('index', { data: results });
  });
});


app.get('/delete/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const [row] = await connection.promise().query('SELECT foto FROM estudiantes WHERE id = ?', [id]);
    const foto = row[0].foto;

    if (foto) {
      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: foto
      };

      await s3.deleteObject(params).promise();
    }

    await connection.promise().query('DELETE FROM estudiantes WHERE id = ?', [id]);
    res.redirect('/');
  } catch (error) {
    console.error('Error al eliminar la foto de S3 o el registro de la base de datos: ' + error);
    res.status(500).send('Error al eliminar la foto o el registro.');
  }
});

app.get('/create', (req, res) => {
  res.render('create');
});

app.post('/save', upload.single('foto'), async (req, res) => {
  const nombre = req.body.nombre;
  const apellidos = req.body.apellidos;
  const correo = req.body.correo;
  const programa = req.body.programa;
  const edad = req.body.edad;
  const dni = req.body.dni;
  const foto = req.file ? req.file.buffer : null;

  try {
    let s3Key = null;

    if (foto) {
      s3Key = `${Date.now()}-${req.file.originalname}`;
      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Key,
        Body: foto
      };

      await s3.upload(params).promise();
    }

    await connection.promise().query(
      'INSERT INTO estudiantes SET ?',
      { nombre, apellidos, correo, programa, edad, dni, foto: s3Key }
    );
    res.redirect('/');
  } catch (error) {
    console.error('Error al subir la foto a S3 o guardar la información en la base de datos: ' + error);
    res.status(500).send('Error al subir la foto o guardar la información.');
  }
});

app.get('/edit/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const [row] = await connection.promise().query('SELECT * FROM estudiantes WHERE id = ?', [id]);
    const estudiantes = row[0];

    if (estudiantes && estudiantes.foto) {
      const fotoUrl = `/fotos/${estudiantes.foto}`; // URL de la foto
      res.render('edit', { estudiantes: estudiantes, fotoUrl: fotoUrl });
    } else {
      // Manejo de error si no se encuentra el registro o no hay foto
      res.status(404).send('Registro no encontrado o sin foto');
    }
  } catch (error) {
    console.error('Error al obtener el registro de la base de datos: ' + error);
    res.status(500).send('Error al obtener el registro.');
  }
});

app.post('/search', (req, res) => {
  const apellido = req.body.apellido;

  const query = 'SELECT * FROM estudiantes WHERE apellidos LIKE ?';
  const searchValue = `%${apellido}%`;

  connection.query(query, [searchValue], (error, results, fields) => {
    if (error) throw error;
    res.render('index', { data: results });
  });
});


app.post('/update', upload.single('foto'), async (req, res) => {
  const id = req.body.id;
  const nombre = req.body.nombre;
  const apellidos = req.body.apellidos;
  const correo = req.body.correo;
  const programa = req.body.programa;
  const edad = req.body.edad;
  const dni = req.body.dni;
  let foto = req.body.foto; // Obtén el nombre de la foto actual

  if (req.file) {
    // Si se seleccionó una nueva foto, elimina la anterior
    if (foto) {
      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: foto
      };
      await s3.deleteObject(params).promise();
    }
    foto = `${Date.now()}-${req.file.originalname}`; // Asigna el nombre de la nueva foto

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: foto,
      Body: req.file.buffer
    };

    await s3.upload(params).promise();
  }

  try {
    await connection.promise().query(
      'UPDATE estudiantes SET nombre = ?, apellidos = ?, correo = ?, programa = ?, edad = ?, dni = ?, foto = ? WHERE id = ?',
      [nombre, apellidos, correo, programa, edad, dni, foto, id]
    );
    res.redirect('/');
  } catch (error) {
    console.error('Error al actualizar el registro en la base de datos: ' + error);
    res.status(500).send('Error al actualizar el registro.');
  }
});

app.get('/delete-all', async (req, res) => {
  try {
    const [rows] = await connection.promise().query('SELECT foto FROM estudiantes');

    const deletePromises = rows.map(async (row) => {
      const foto = row.foto;

      if (foto) {
        const params = {
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: foto
        };

        await s3.deleteObject(params).promise();
      }
    });

    await Promise.all(deletePromises);

    await connection.promise().query('DELETE FROM estudiantes');

    res.redirect('/');
  } catch (error) {
    console.error('Error al eliminar las imágenes de S3 o los registros de la base de datos: ' + error);
    res.status(500).send('Error al eliminar las imágenes o los registros.');
  }
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
