import express from 'express'
import cors from 'cors'
import http from 'http'
import fs from 'fs'
import session from 'express-session'
import passport from 'passport'
// Une des stratégies d'authentification fourni par Passport
import { Strategy as LocalStrategy } from 'passport-local'
import {
  connectMongo,
  createPlayer, createAdmin, getPlayers, getPlayerById, getAdmin, getAdminByPseudonyme, updatePlayer,
  getGoals, getGoalsByPlayerId, erasePlayerById, eraseAllPlayers,
} from './database.js'
import { Auth } from './utils/AuthClass.js'
import { sendRegistrationEmail, sendWarningEmail } from './mailer.js'
import MongoStore from 'connect-mongo'
//import { saveTwitchToken } from './utils/twitchTokenManager.js'
//import { startBot } from './twitchBot.js'


// Charger la configuration depuis config.json
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'))
const CLIENT_ID = config.clientId
const CLIENT_SECRET = config.clientSecret
const ADMIN_TOKEN = config.adminToken

const app = express()
app.use(express.json())
app.use(cors({
  origin: [
    "https://une-goutte-pour-l-au-dela.onrender.com",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Credentials"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}))

// Middleware pour parser les données du formulaire
app.use(express.urlencoded({ extended: true }));

// Middleware pour gérer les sessions 
app.use(session({
  secret: ADMIN_TOKEN,
  resave: true,
  saveUninitialized: true,
  store: MongoStore.create({
    mongoUrl: 'mongodb+srv://califeryan_db_user:DZqeO797brr9G5OF@cluster0.j5ezvv2.mongodb.net/ramadan-project',
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}))

app.use(passport.initialize())
// Passport utilise la session (express-session) pour stocker l’identifiant de l’utilisateur (défini par serializeUser) entre les requêtes HTTP.
app.use(passport.session())


// --- Passport.js : Auth locale, session, routes sécurisées ---
// Stratégie locale (email/mot de passe)
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const players = await getPlayers()
      const player = players ? players.find(user => user.email === email) : null

      // Envoie le message à la route de connexion
      if (!player) return done(null, false, { message: 'Utilisateur non trouvé' })
      // Compare le mot de passe fourni avec le hash stocké dans la base de données
      const isMatch = await Auth.comparePassword(password, player.password)
      // Envoie le message à la route de connexion
      if (!isMatch) return done(null, false, { message: 'Mot de passe incorrect' })

      return done(null, player)
    } catch (err) {
      return done(err)
    }
  }
))

// Stratégie locale pour l'admin
passport.use('local-admin', new LocalStrategy(
  { usernameField: 'pseudonyme', passwordField: 'password', passReqToCallback: true },
  async (req, pseudonyme, password, done) => {
    try {
      // Vérifie le token d'authentification dans le corps de la requête
      const authToken = req.body?.authToken
      if (authToken !== ADMIN_TOKEN) {
        // Envoie le message à la route de connexion admin
        return done(null, false, { message: 'Token admin invalide' })
      }

      const adminData = await getAdmin(pseudonyme)
      if (!adminData) return done(null, false, { message: 'Admin non trouvé' })

      const isMatch = await Auth.comparePassword(password, adminData.password)
      if (!isMatch) return done(null, false, { message: 'Mot de passe incorrect' })

      return done(null, adminData)
    } catch (err) {
      return done(err)
    }
  }
))

passport.serializeUser((user, done) => {
  done(null, user._id)
})

passport.deserializeUser(async (id, done) => {
  try {
    console.log('Deserializing user with id:', id)  // 🔍 Log l'ID
    const user = await getPlayerById(id)
    console.log('User found:', user ? 'Yes' : 'No')  // 🔍 Log si trouvé
    done(null, user)
  } catch (err) {
    console.error('Deserialization error:', err)  // 🔍 Log l'erreur
    done(err)
  }
})

// Middleware pour protéger les routes
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next()
  res.status(401).json({ message: 'Non authentifié' })
}


// Crée le serveur HTTP
const server = http.createServer(app)

// --- Routes API ---

app.post('/createPlayer', (req, res) => {
  // Destructure les données du joueur depuis les paramètres de la requête
  const { name, email, password, goal, secondGoal = "", thirdGoal = "" } = req.body

  // Vérifie que les données nécessaires sont présentes
  if (!name || !email || !password || !goal) {
    return res.status(400).json({ message: 'Données de joueur manquantes' })
  }

  createPlayer({ name, email, password, goal, secondGoal, thirdGoal })
    .then((id) => getPlayerById(id)) // Récupère le joueur créé pour la vérification
    .then(player => {
      // Vérifie que le joueur a bien été créé et envoyé dans la réponse
      if (player && player._id) {

        console.log('Le joueur créé est bien en base de données:', player)
        res.status(201).json({ success: true, message: 'Joueur créé avec succès' })

        // Envoyer l'email de bienvenue après la création du joueur
        sendRegistrationEmail(player.email, player.name, player._id)
      } else {
        res.status(500).json({ success: false, message: 'Erreur lors de la création du joueur' })
      }
    })
    .catch(error => res.status(500).json({ success: false, message: 'Erreur lors de la création du joueur', error }))
})


app.post('/createAdmin', (req, res) => {
  const { name, password, authToken } = req.body

  // Vérifie que les données nécessaires sont présentes et que le token d'authentification est valide
  if (!name || !password || !authToken) {
    return res.status(400).json({ message: 'Données de l\'admin manquantes' })
  }
  if (authToken !== ADMIN_TOKEN) {
    return res.status(403).json({ message: 'Token d\'authentification invalide pour la création de l\'admin.' })
  }

  createAdmin({ name, password })
    .then(name => getAdmin(name, password)) // Récupère l'admin créé pour l'envoyer dans la réponse
    .then(admin => {
      if (admin) {
        res.status(201).json({ success: true, message: 'Admin créé avec succès' })
      } else {
        res.status(500).json({ success: false, message: 'Erreur lors de la création de l\'admin' })
      }
    })
    .catch(error => res.status(500).json({ success: false, message: 'Erreur lors de la création de l\'admin', error }))
})

app.get('/verifEmail', (req, res) => {
  const email = req.query.email
  if (!email) {
    return res.status(400).json({ message: 'Email manquant' })
  }
  getPlayers()
    .then(players => {
      if (players && players.some(player => player.email === email)) {
        return res.status(200).json({ success: false })
      } else {
        return res.status(200).json({ success: true })
      }
    })
    .catch(error => res.status(500).json({ message: 'Erreur lors de la vérification de l\'email', error }))
})

app.post('/resendEmail', (req, res) => {
  const { id } = req.body

  if (!id) {
    return res.status(400).json({ message: 'ID de joueur invalide' })
  }
  getPlayerById(id)
    .then(player => {
      if (player) {
        sendRegistrationEmail(player.email, player.name, player._id)
      } else {
        res.status(404).json({ message: 'Joueur non trouvé' })
      }
    })
    .catch(error => res.status(500).json({ message: 'Erreur lors du renvoi de l\'email', error }))
})

app.post('/sendWarning', (req, res) => {
  const { id } = req.body

  if (!id) {
    return res.status(400).json({ message: 'ID de joueur invalide' })
  }
  getPlayerById(id)
    .then(player => {
      if (player) {
        sendWarningEmail(player.email, player.name, player._id)
      } else {
        res.status(404).json({ message: 'Joueur non trouvé' })
      }
    })
    .catch(error => res.status(500).json({ message: 'Erreur lors du renvoi de l\'email', error }))
})


app.get('/getPlayers', (req, res) => {
  getPlayers()
    .then(players => res.status(200).json({ players: players }))
    .catch(error => res.status(500).json({ message: 'Erreur lors de la récupération des joueurs', error }))
})

app.get('/getPlayerById', (req, res) => {
  const id = req.query.id
  if (!id) {
    return res.status(400).json({ message: 'ID de joueur invalide' })
  }
  getPlayerById(id)
    .then(player => {
      if (player) {
        res.status(200).json({ player: player })
      } else {
        res.status(404).json({ message: 'Joueur non trouvé' })
      }
    })
    .catch(error => res.status(500).json({ message: 'Erreur lors de la récupération du joueur', error }))
})

app.post('/updatePlayer', (req, res) => {

  // Déstructure les données de mise à jour pour l'update du nom du joueur
  const { id, updateType, toUpdate } = req.body

  // Vérifie que les données nécessaires sont présentes dans la requête
  if (id === undefined || updateType === undefined || toUpdate === undefined) {
    return res.status(400).json({ message: 'Données de mise à jour manquantes' })
  }

  // Appelle la fonction d'update du joueur dans la base de données
  updatePlayer({ id, updateType, toUpdate })
    .then(() => {
      return res.status(200).json({ success: true, message: 'Joueur mis à jour' })
    })
    .catch(error => {
      return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du joueur', error })
    })

})

app.get('/getGoals', (req, res) => {
  getGoals()
    .then(goals => res.status(200).json({ goals: goals }))
    .catch(error => res.status(500).json({ message: 'Erreur lors de la récupération des goals', error }))
})

app.get('/getGoalsByPlayerId', (req, res) => {
  const playerId = req.query.playerId

  // Vérifie que l'ID du joueur est un nombre valide
  if (!playerId) {
    return res.status(400).json({ message: 'ID de joueur invalide' })
  }
  getGoalsByPlayerId(playerId)
    .then(goals => res.status(200).json({ goals: goals }))
    .catch(error => res.status(500).json({ message: 'Erreur lors de la récupération des goals', error }))
})

app.delete('/erasePlayerById', (req, res) => {
  const id = req.query.id

  if (!id) {
    return res.status(400).json({ message: 'ID de joueur invalide' })
  }
  erasePlayerById(id)
    .then(() => res.status(200).json({ success: true, message: 'Joueur effacé' }))
    .catch(error => res.status(500).json({ success: false, message: 'Erreur lors de l\'effacement du joueur', error }))
})

app.delete('/eraseAllPlayers', (req, res) => {
  const authToken = req.query.authToken
  // Vérifie que le token d'authentification est présent et valide
  if (authToken !== ADMIN_TOKEN) {
    return res.status(403).json({ message: 'Token d\'authentification invalide pour l\'effacement des joueurs.' })
  }

  eraseAllPlayers()
    .then(() => res.status(200).json({ success: true, message: 'Tous les joueurs effacés' }))
    .catch(error => res.status(500).json({ success: false, message: 'Erreur lors de l\'effacement des joueurs', error }))
})


// --- Routes de login Passport ---
app.post('/login', (req, res, next) => {
  console.log('=== /login called ===')  // 🔍
  console.log('Body:', req.body)  // 🔍
  
  passport.authenticate('local', (err, user, info) => {
    console.log('Passport callback - err:', err)  // 🔍
    console.log('Passport callback - user:', user)  // 🔍
    console.log('Passport callback - info:', info)  // 🔍
    
    if (err) {
      console.error('Auth error:', err)
      return res.status(500).json({ message: 'Erreur lors de la connexion', error: err })
    }
    
    if (!user) {
      console.log('No user found')
      return res.status(401).json({ incorrect: true, message: info?.message || 'Identifiants invalides' })
    }

    console.log('User found:', user._id)  // 🔍
    
    req.logIn(user, loginErr => {
      console.log('After logIn - err:', loginErr)  // 🔍
      console.log('After logIn - sessionID:', req.sessionID)  // 🔍
      console.log('After logIn - req.user:', req.user)  // 🔍
      
      if (loginErr) {
        console.error('Login error:', loginErr)
        return res.status(500).json({ message: 'Erreur lors de la connexion', error: loginErr })
      }
      
      console.log('Login successful - sending response')  // 🔍
      res.status(200).json({ message: 'Connexion réussie', user: req.user })
    })
  })(req, res, next)
})


app.post('/adminLogin', (req, res, next) => {
  passport.authenticate('local-admin', (err, admin, info) => {
    if (err) {
      return res.status(500).json({ message: 'Erreur lors de la connexion admin', error: err })
    }
    if (!admin) {
      return res.status(401).json({ message: info?.message || 'Identifiants admin invalides' })
    }
    req.logIn(admin, loginErr => {
      if (loginErr) {
        return res.status(500).json({ message: 'Erreur lors de la connexion admin', error: loginErr })
      }
      res.status(200).json({ message: 'Connexion admin réussie', admin: req.user })
    })
  })(req, res, next)
})

// Exemple de route privée protégée
app.get('/prive', ensureAuthenticated, (req, res) => {
  res.json({ message: 'Bienvenue !', user: req.user })
})

// Route de déconnexion
app.get('/logout', (req, res) => {
  // Utilise la méthode de déconnexion de Passport pour terminer la session
  req.logout(err => {
    if (err) return res.status(500).json({ message: 'Erreur', error: err })
    // Détruit la session et efface le cookie de session
    req.session.destroy(() => {
      res.clearCookie('connect.sid')
      res.status(200).json({ success: true, message: 'Déconnexion réussie' })
    })
  })
})

app.get('/clientId', (req, res) => {
  if (!CLIENT_ID) {
    return res.status(500).json({ message: 'Le client ID est introuvable dans la configuration' })
  }
  res.status(200).json({ clientId: CLIENT_ID })
})

app.get('/twitchCode', (req, res) => {

  const code = req.query.code
  if (!code) {
    console.error('Aucun code reçu de Twitch')
  }
  else {
    console.log("Code Twitch reçu:", code)
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ message: 'Le client ID ou le client secret est introuvable dans la configuration' })
  }
  // Construis les paramètres pour l'url d'échange de code
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: 'http://localhost:3000' // Doit correspondre à l'URI enregistrée dans l'application Twitch
  })

  // Fetch l'url avec les paramètres pour obtenir le token d'accès
  fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params
  })
    .then(response => response.json())
    .then(data => {
      console.log('Token d\'accès reçu de Twitch.')

      // Token valide, on sauvegarde le token d'accès dans la base de données
      if (data.access_token) {
        // Ajoute la date d'obtention du token
        data.obtentionDate = new Date().getTime()

        saveTwitchToken(data) // Sauvegarde dans la base de donnée
          .then(() => {
            // Démarrer le bot Twitch après avoir sauvegardé le token
            startBot()
          })
      }
    })
    .catch(error => {
      console.error('Erreur lors de l\'échange du code:', error)
      res.status(500).json({ message: 'Erreur lors de l\'échange du code', error })
    })

})


// Export a function to start the server (utilisée par dev.js)
export async function startServer(port) {
  try {
    server.listen(port, () => {
      console.log(`Server is running on port ${port}`)
      connectMongo() // Connecte à MongoDB au démarrage du serveur

      // Démarrer le bot APRÈS que le serveur soit prêt
      /*
      console.log('Starting Twitch bot...')
      startBot()
      */
    })
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}
