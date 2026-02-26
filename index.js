import express from 'express'
import cors from 'cors'
import http from 'http'
import fs from 'fs'
import jwt from 'jsonwebtoken'  // 🔑 Nouveau
import passport from 'passport'
import { Strategy as LocalStrategy } from 'passport-local'
import {
  connectMongo,
  createPlayer, getPlayers, getPlayerById, getAdminByPseudonyme, getAdminById, updatePlayer,
  getGoals, getGoalsByPlayerId, erasePlayerById, eraseAllPlayers,
} from './database.js'
import { Auth } from './utils/AuthClass.js'
import { sendRegistrationEmail, sendWarningEmail } from './mailer.js'

// Charger la configuration depuis config.json
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'))
const CLIENT_ID = config.clientId
const CLIENT_SECRET = config.clientSecret
const ADMIN_TOKEN = config.adminToken
const JWT_SECRET = ADMIN_TOKEN  // 🔑 Utilise ADMIN_TOKEN comme secret JWT

const app = express()

// 1. CORS en PREMIER
app.use(cors({
  origin: [
    "https://une-goutte-pour-l-au-dela.onrender.com",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],  // ✅ Enlevé "Credentials"
  preflightContinue: false,
  optionsSuccessStatus: 204
}))

// 2. Parsers
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// 🔑 NOUVEAU : Middleware JWT pour vérifier les tokens
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1]  // "Bearer TOKEN"
  
  if (!token) {
    console.log('Pas de token JWT fourni dans la requête /prive')
    return res.status(401).json({ message: 'Non authentifié - token manquant' })
  }
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error('Erreur de vérification JWT :', err.message)
      return res.status(401).json({ message: 'Token invalide ou expiré' })
    }
    
    if (decoded.isAdmin) {
      return res.status(403).json({ message: 'Accès refusé - token admin ne peut accéder à cette route' })
    }
    
    console.log('JWT vérifié pour l\'utilisateur :', decoded.userId)
    req.userId = decoded.userId
    next()
  })
}

// 🔑 NOUVEAU : Middleware JWT pour l'admin
function verifyAdminJWT(req, res, next) {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1]
  
  if (!token) {
    console.log('Pas de token JWT fourni dans la requête /adminPrive')
    return res.status(401).json({ message: 'Non authentifié - token admin manquant' })
  }
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error('Erreur de vérification JWT :', err.message)
      return res.status(401).json({ message: 'Token admin invalide ou expiré' })
    }

    if (decoded.isAdmin !== true) {
      return res.status(403).json({ message: 'Accès admin refusé' })
    }
    
    console.log('JWT vérifié pour l\'admin :', decoded.userId)
    req.userId = decoded.userId
    next()
  })
}

// --- Stratégies Passport (gardées pour valider les credentials) ---
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const players = await getPlayers()
      const player = players ? players.find(user => user.email === email) : null

      if (!player) return done(null, false, { message: 'Utilisateur non trouvé' })
      const isMatch = await Auth.comparePassword(password, player.password)
      if (!isMatch) return done(null, false, { message: 'Mot de passe incorrect' })

      return done(null, player)
    } catch (err) {
      return done(err)
    }
  }
))

passport.use('local-admin', new LocalStrategy(
  { usernameField: 'pseudonyme', passwordField: 'password', passReqToCallback: true },
  async (req, pseudonyme, password, done) => {
    try {
      
      const authToken = req.body?.authToken
      if (authToken !== ADMIN_TOKEN) {
        return done(null, false, { message: 'Token admin invalide' })
      }

      const admin = await getAdminByPseudonyme(pseudonyme)
      if (!admin) return done(null, false, { message: 'Admin non trouvé' })

      const isMatch = await Auth.comparePassword(password, admin.password)
      if (!isMatch) return done(null, false, { message: 'Mot de passe incorrect' })

      return done(null, admin)
    } catch (err) {
      return done(err)
    }
  }
))

app.use(passport.initialize())

// Crée le serveur HTTP
const server = http.createServer(app)

// --- Routes API ---

app.post('/api/createPlayer', (req, res) => {
  const { name, email, password, goal, secondGoal = "", thirdGoal = "" } = req.body

  if (!name || !email || !password || !goal) {
    return res.status(400).json({ message: 'Données de joueur manquantes' })
  }

  createPlayer({ name, email, password, goal, secondGoal, thirdGoal })
    .then((id) => getPlayerById(id))
    .then(player => {
      if (player && player._id) {
        console.log('Le joueur créé est bien en base de données:', player)

        res.status(201).json({ success: true, message: 'Joueur créé avec succès' })
        sendRegistrationEmail(player.email, player.name, player._id)
      } else {
        res.status(500).json({ success: false, message: 'Erreur lors de la création du joueur' })
      }
    })
    .catch(error => res.status(500).json({ success: false, message: 'Erreur lors de la création du joueur', error }))
})

app.get('/api/verifEmail', (req, res) => {
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

app.post('/api/resendEmail', (req, res) => {
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

app.post('/api/sendWarning', (req, res) => {
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

app.get('/api/getPlayers', (req, res) => {
  getPlayers()
    .then(players => res.status(200).json({ players: players }))
    .catch(error => res.status(500).json({ message: 'Erreur lors de la récupération des joueurs', error }))
})

app.get('/api/getPlayerById', (req, res) => {
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

app.post('/api/updatePlayer', verifyJWT, (req, res) => {
  const { id, updateType, toUpdate } = req.body

  // 🔑 Vérifier que l'utilisateur ne modifie que ses propres données
  if (req.userId !== id) {
    return res.status(403).json({ message: 'Accès refusé - vous ne pouvez modifier que vos propres données' })
  }

  if (id === undefined || updateType === undefined || toUpdate === undefined) {
    return res.status(400).json({ message: 'Données de mise à jour manquantes' })
  }

  updatePlayer({ id, updateType, toUpdate })
    .then(() => {
      return res.status(200).json({ success: true, message: 'Joueur mis à jour' })
    })
    .catch(error => {
      return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du joueur', error })
    })
})

app.get('/api/getGoals', (req, res) => {
  getGoals()
    .then(goals => res.status(200).json({ goals: goals }))
    .catch(error => res.status(500).json({ message: 'Erreur lors de la récupération des goals', error }))
})

app.get('/api/getGoalsByPlayerId', (req, res) => {
  const playerId = req.query.playerId

  if (!playerId) {
    return res.status(400).json({ message: 'ID de joueur invalide' })
  }
  getGoalsByPlayerId(playerId)
    .then(goals => res.status(200).json({ goals: goals }))
    .catch(error => res.status(500).json({ message: 'Erreur lors de la récupération des goals', error }))
})

app.delete('/api/erasePlayerById', (req, res) => {
  const id = req.query.id

  if (!id) {
    return res.status(400).json({ message: 'ID de joueur invalide' })
  }
  erasePlayerById(id)
    .then(() => res.status(200).json({ success: true, message: 'Joueur effacé' }))
    .catch(error => res.status(500).json({ success: false, message: 'Erreur lors de l\'effacement du joueur', error }))
})

app.delete('/api/eraseAllPlayers', (req, res) => {
  const authToken = req.query.authToken
  if (authToken !== ADMIN_TOKEN) {
    return res.status(403).json({ message: 'Token d\'authentification invalide pour l\'effacement des joueurs.' })
  }

  eraseAllPlayers()
    .then(() => res.status(200).json({ success: true, message: 'Tous les joueurs effacés' }))
    .catch(error => res.status(500).json({ success: false, message: 'Erreur lors de l\'effacement des joueurs', error }))
})

// --- Routes d'authentification JWT ---

// 🔑 LOGIN JOUEUR avec JWT
app.post('/api/login', (req, res, next) => {
  if (req.body.email === "admin@admin.com" && req.body.password === "adminpass") {
    // Si un admin essaie de se connecter via la route login, on lui autorise d'utiliser la route adminLogin
    res.status(201).json({ success : true, message: 'Veuillez utiliser la route /adminLogin pour vous connecter en tant qu\'admin.' })
    return
  }

  console.log('=== /login appelé ===')
  console.log('Body:', req.body)
  
  // Utilise la stratégie "local" pour récupérer l'utilisateur 
  passport.authenticate('local', (err, user, info) => {
    console.log('Callback de Passport - user:', user ? user._id : null)
    
    if (err) {
      console.error('Erreur d\'authentification :', err)
      return res.status(500).json({ message: 'Erreur lors de la connexion', error: err })
    }
    
    if (!user) {
      console.log('Aucun utilisateur trouvé')
      return res.status(401).json({ incorrect: true, message: info?.message || 'Identifiants invalides' })
    }

    // 🔑 Créez un JWT au lieu d'une session
    const token = jwt.sign(
      { userId: user._id, isAdmin: false },
      JWT_SECRET,
      { expiresIn: '24h' }
    )
    
    console.log('JWT créé pour l\'utilisateur :', user._id)
    res.status(200).json({ 
      message: 'Connexion réussie', 
      user: user,
      token: token  // 🔑 Envoyez le token
    })
  })(req, res, next)
})

// 🔑 LOGIN ADMIN avec JWT
app.post('/api/adminLogin', (req, res, next) => {
  console.log('=== /adminLogin appelé ===')
  
  passport.authenticate('local-admin', (err, admin, info) => {
    if (err) {
      console.error('Erreur d\'authentification admin :', err)
      return res.status(500).json({ message: 'Erreur lors de la connexion admin', error: err })
    }
    
    if (!admin) {
      return res.status(401).json({ message: info?.message || 'Identifiants admin invalides' })
    }

    // 🔑 Créez un JWT admin
    const token = jwt.sign(
      { userId: admin._id, isAdmin: true },
      JWT_SECRET,
      { expiresIn: '24h' }
    )
    
    console.log('JWT admin créé pour l\'utilisateur :', admin._id)
    res.status(200).json({ 
      message: 'Connexion admin réussie', 
      admin: admin,
      token: token  // 🔑 Envoyez le token
    })
  })(req, res, next)
})

// 🔑 Route privée protégée par JWT
app.get('/api/prive', verifyJWT, (req, res) => {
  getPlayerById(req.userId)
    .then(user => {
      if (user) {
        res.json({ message: 'Bienvenue !', user: user })
      } else {
        res.status(404).json({ message: 'Utilisateur non trouvé' })
      }
    })
    .catch(error => res.status(500).json({ message: 'Erreur', error }))
})

// 🔑 Route admin protégée par JWT
app.get('/api/adminPrive', verifyAdminJWT, async (req, res) => {
  getAdminById(req.userId)
    .then(admin => {
      if (admin) {
        res.json({ message: 'Bienvenue !', admin: admin })
      } else {
        res.status(404).json({ message: 'Admin non trouvé' })
      }
    })
    .catch(error => res.status(500).json({ message: 'Erreur', error }))
})


// --- Routes Twitch OAuth ---
app.get('/api/clientId', (req, res) => {
  if (!CLIENT_ID) {
    return res.status(500).json({ message: 'Le client ID est introuvable dans la configuration' })
  }
  res.status(200).json({ clientId: CLIENT_ID })
})

app.get('/api/twitchCode', (req, res) => {
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
  
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: 'http://localhost:3000'
  })

  fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params
  })
    .then(response => response.json())
    .then(data => {
      console.log('Token d\'accès reçu de Twitch.')

      if (data.access_token) {
        data.obtentionDate = new Date().getTime()
        // saveTwitchToken(data)
        // startBot()
      }
    })
    .catch(error => {
      console.error('Erreur lors de l\'échange du code:', error)
      res.status(500).json({ message: 'Erreur lors de l\'échange du code', error })
    })
})


export async function startServer(port) {
  try {
    server.listen(port, () => {
      console.log(`Server is running on port ${port}`)
      connectMongo()
    })
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}
