import { MongoClient } from 'mongodb'
import { Auth } from './utils/AuthClass.js'
import fs from 'fs'

const uri = 'mongodb+srv://califeryan_db_user:DZqeO797brr9G5OF@cluster0.j5ezvv2.mongodb.net/?appName=Cluster0' // Mets ici ton URI Atlas
const client = new MongoClient(uri, { tls: true })
let playersCollection
let countersCollection
let goalsCollection
let adminCollection
// let tokensCollection

// Charger la configuration depuis config.json
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'))


// Fonction pour se connecter à MongoDB et initialiser les collections
export async function connectMongo() {
  // 
  if (!playersCollection || !goalsCollection || !countersCollection || !adminCollection) {
    await client.connect()
    const db = client.db('ramadan-project') // Mets ici le nom de ta base de données
    if (!db) {
      throw new Error('Impossible de se connecter à la base de données MongoDB.')
    } else {
      console.log('Connecté à MongoDB.')
    }
    playersCollection = db.collection('players')
    countersCollection = db.collection('counters')
    goalsCollection = db.collection('goals')
    adminCollection = db.collection('admin')
    //tokensCollection = db.collection('tokens')

    // Initialisation du document si aucun document n'existe
    const playerDoc = await playersCollection.findOne({})
    const counterDoc = await countersCollection.findOne({ _id: 'counterId' })
    const goalDoc = await goalsCollection.findOne({})
    const adminDoc = await adminCollection.findOne({})
    // Si aucun document n'existe, on en crée un avec les champs nécessaires
    if (!playerDoc) {
      // Récupère la date
      const now = new Date()

      // Initialise le compteur si absent
      if (!counterDoc) {
        await countersCollection.insertOne({ _id: 'counterId', value: 0 })
        console.log('Compteur initialisé dans MongoDB.')
      }
      // Génère le premier id
      const newId = await getNextSequence()
      console.log('Premier ID généré pour le joueur test:', newId)

      // Insère le document de joueurs avec les champs nécessaires
      await playersCollection.insertOne({ _id: newId, name: "", email: "", password: "", goal: "", dateValidate: now.getTime(), secondGoal: "", dateValidateSecond: now.getTime(), thirdGoal: "", dateValidateThird: now.getTime(), level: 0, lastLevelUp: now.getTime(), money: 0, creationDate: now.getTime(), emailSent: false, warningSent: false })
      console.log('Document de joueurs initialisé dans MongoDB.')
    }
    if (!goalDoc) {
      const now = new Date()
      await goalsCollection.insertOne({ _id: 'main', playerId: "", name: "", doneGoal: "", doneDate: now.getTime() })

      console.log('Document de goals initialisé dans MongoDB.')
    }
    if (!adminDoc) {
      const adminPasswordHash = await Auth.hashPassword('MuminAdmin92100!')
      await adminCollection.insertOne({ _id: 1000, pseudonyme: 'mumin', password: adminPasswordHash })
      console.log('Document d\'admin initialisé dans MongoDB.')
    }
  }

}

async function getNextSequence() {
  await connectMongo()
  // Récupère le compteur actuel
  const actualId = await countersCollection.findOne({ _id: "counterId" })

  if (!actualId) {
    throw new Error('Compteur non trouvé dans MongoDB')
  }
  const newID = actualId.value + 1 // Incrémente le compteur

  console.log('ID actuel du compteur:', actualId.value)
  // Met à jour le compteur dans la base de données
  await countersCollection.updateOne(
    { _id: "counterId" },
    { $set: { value: newID } },
    { upsert: true }
  )
  // Retourne le nouvel ID généré
  return newID
}

export async function createPlayer({ name, email, password, goal, secondGoal, thirdGoal }) {
  await connectMongo()
  const now = new Date()
  now.setDate(now.getDate() - 1) // Soustrait 1 jour à la date actuelle pour permettre au joueur de valider son objectif dès le premier jour

  // Génère un nouvel id auto-incrémenté pour le joueur
  const newId = await getNextSequence()
  // Hash le mot de passe avant de le stocker
  const passwordHash = await Auth.hashPassword(password)
  await playersCollection.insertOne({ _id: newId, name: name, email: email, password: passwordHash, goal: goal, dateValidate: now.getTime(), secondGoal: secondGoal, dateValidateSecond: now.getTime(), thirdGoal: thirdGoal, dateValidateThird: now.getTime(), level: 0, lastLevelUp: now.getTime(), money: 0, creationDate: now.getTime(), emailSent: false, warningSent: false })

  console.log('Joueur créé dans MongoDB avec ID:', newId)
  return newId
}

export async function getPlayers() {
  await connectMongo()
  // Récupère tous les joueurs de la collection
  const allPlayers = await playersCollection.find({}).toArray()
  return allPlayers ? allPlayers : null
}

export async function getPlayerById(id) {
  await connectMongo()
  // Récupère le joueur par id
  const player = await playersCollection.findOne({ _id: id })
  return player ? player : null
}

// Fonction pour addDoneGoal
export async function getNameById(id) {
  await connectMongo()
  // Récupère le joueur par id
  const player = await playersCollection.findOne({ _id: id })
  return player ? player.name : null
}

export async function getAdminByPseudonyme(pseudonyme) {
  await connectMongo()
  const admin = await adminCollection.findOne({ pseudonyme: pseudonyme })
  return admin ? admin : null
}

export async function getAdminById(id) {
  await connectMongo()
  const admin = await adminCollection.findOne({ _id: id })
  return admin ? admin : null
}

export async function savePlayer({ id, level, money }) {
  await connectMongo()
  // Récupère le player existant
  const existing = await playersCollection.findOne({ _id: id })

  // Si le player existe, met à jour son niveau, sa date de dernier level up et son argent
  if (existing && typeof level !== 'undefined') {
    const now = new Date()
    await playersCollection.updateOne(
      { _id: id },
      { $set: { level: level, lastLevelUp: now.getTime(), money: money } },
      { upsert: true }
    )
    console.log('Player actualisé et sauvegardé dans MongoDB.')
  }
}

export async function updatePlayer({ id, updateType, toUpdate }) {
  if (id < 1000) {
    console.error('Mise à jour interdite pour l\'ID "main".')
    return
  }
  await connectMongo()

  const now = new Date()
  // Récupère le nom du joueur pour l'ajouter dans les objectifs validés
  const name = id ? await getNameById(id) : null

  // En fonction du type de mise à jour, met à jour le champ correspondant du joueur
  switch (updateType) {
    // Si le type de mise à jour est "name"
    case 'name':
      // Met à jour le champ "name" du joueur avec la nouvelle valeur "toUpdate"
      await playersCollection.updateOne(
        { _id: id },
        { $set: { name: toUpdate } },
        { upsert: true }
      )
      break
    case 'email':
      await playersCollection.updateOne(
        { _id: id },
        { $set: { email: toUpdate } },
        { upsert: true }
      )
      break
    case 'password':
      const passwordHash = await Auth.hashPassword(toUpdate)
      await playersCollection.updateOne(
        { _id: id },
        { $set: { password: passwordHash } },
        { upsert: true }
      )
      break
    case 'goal':
      await playersCollection.updateOne(
        { _id: id },
        { $set: { goal: toUpdate, dateValidate: now.getTime() } },
        { upsert: true }
      )

      // Ajoute l'objectif validé
      addDoneGoal({ playerId: id, name: name, doneGoal: toUpdate })
      break
    case 'secondGoal':
      await playersCollection.updateOne(
        { _id: id },
        { $set: { secondGoal: toUpdate, dateValidateSecond: now.getTime() } },
        { upsert: true }
      )

      addDoneGoal({ playerId: id, name: name, doneGoal: toUpdate })
      break
    case 'thirdGoal':
      await playersCollection.updateOne(
        { _id: id },
        { $set: { thirdGoal: toUpdate, dateValidateThird: now.getTime() } },
        { upsert: true }
      )

      addDoneGoal({ playerId: id, name: name, doneGoal: toUpdate })
      break
    case 'level':
      await playersCollection.updateOne(
        { _id: id },
        { $set: { level: toUpdate, lastLevelUp: now.getTime() } },
        { upsert: true }
      )
      break
    case 'money':
      await playersCollection.updateOne(
        { _id: id },
        { $set: { money: toUpdate } },
        { upsert: true }
      )
      break
      case 'emailSent':
        await playersCollection.updateOne(
          { _id: id },
          { $set: { emailSent: toUpdate } },
          { upsert: true }
        )
        break
        case 'warningSent':
          await playersCollection.updateOne(
            { _id: id },
            { $set: { warningSent: toUpdate } },
            { upsert: true }
          )
          break
    default:
      console.error('Type de mise à jour inconnu:', updateType)
  }

  console.log('Joueur modifié dans MongoDB.')
}

export async function addDoneGoal({ playerId, name, doneGoal }) {
  await connectMongo()
  const now = new Date()
  await goalsCollection.insertOne({ playerId: playerId, name: name, doneGoal: doneGoal, doneDate: now.getTime() })

  console.log('Goal ajouté dans MongoDB.')
}

export async function getGoals() {
  await connectMongo()
  // Récupère tous les objectifs ({} signifie tous les documents) de la collection "goals" et les convertit en tableau avec toArray()
  const allGoals = await goalsCollection.find({}).toArray()
  return allGoals ? allGoals : null
}

export async function getGoalsByPlayerId(playerId) {
  await connectMongo()
  const playerGoals = await goalsCollection.find({ playerId: playerId }).toArray()
  return playerGoals ? playerGoals : null
}

export async function erasePlayerById(id) {
  await connectMongo()
  await playersCollection.deleteOne({ _id: id })
  console.log('Joueur supprimé de MongoDB.')
}

export async function eraseAllPlayers() {
  await connectMongo()
  await playersCollection.deleteMany({})
  console.log('Tous les joueurs supprimés de MongoDB.')
}


// Fonctions utilitaires pour le token Twitch
export async function saveTwitchToken(tokenObj) {
  await connectMongo()
  await tokensCollection.updateOne(
    { _id: 'main' },
    { $set: { token: tokenObj } },
    { upsert: true }
  )
  console.log('Token Twitch sauvegardé dans MongoDB.')
}

export async function getTwitchToken() {
  await connectMongo()
  const doc = await tokensCollection.findOne({ _id: 'main' })
  return doc ? doc.token : null
}

