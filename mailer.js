import nodemailer from 'nodemailer'
import fs from 'fs'
import { updatePlayer } from './database.js'

// Configuration du transporteur SMTP
const transporter = nodemailer.createTransport({
    host: 'in-v3.mailjet.com',
    port: 587,
    secure: false,
    auth: {
        user: 'aa9056475f9d84462c6502c8fc26d6ff', // Remplacez par votre clé API Mailjet
        pass: '25fc45417e47cca4021a6f49133b097e' // Remplacez par votre clé secrète Mailjet
    }
})
const fromEmail = '' // Adresse email de l'expéditeur


export async function sendRegistrationEmail(toEmail, name, userId) {

    // Lecture du template HTML et remplacement des variables
    let html = fs.readFileSync("./emailRegistration.html", "utf8")
    html = html.replace(/{{name}}/g, name)
    
    // Options de l'email
    const mailOptions = {
        from: fromEmail,   // Expéditeur
        to: toEmail,       // Destinataire
        subject: "Bienvenue dans Une Goutte pour l’Eau Dela", // Objet de l'email
        html: html                     // Corps de l'email en HTML
    }

    // Envoi de l'email
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log('Erreur lors de l\'envoi :', error)
        } else {
            console.log('Email envoyé avec succès :', info.response)
            updatePlayer({ id: userId, updateType: 'emailSent', toUpdate: true }) // Met à jour le champ emailSent à true en cas de succès d'envoi
            .catch(error => console.log('Erreur lors de la mise à jour du joueur après envoi de l\'email :', error))
        }
    })
}

export async function sendWarningEmail(toEmail, name, userId) {

    // Lecture du template HTML et remplacement des variables
    let html = fs.readFileSync("./emailWarning.html", "utf8")
    html = html.replace(/{{name}}/g, name)
    
    // Options de l'email
    const mailOptions = {
        from: fromEmail,   // Expéditeur
        to: toEmail,                   // Destinataire
        subject: "Alerte : Action requise avant suppression de compte", // Objet de l'email
        html: html                     // Corps de l'email en HTML
    }

    // Envoi de l'email
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log('Erreur lors de l\'envoi :', error)
        } else {
            console.log('Email envoyé avec succès :', info.response)
            updatePlayer({ id: userId, updateType: 'warningSent', toUpdate: true }) // Met à jour le champ warningSent à true en cas de succès d'envoi
            .catch(error => console.log('Erreur lors de la mise à jour du joueur après envoi de l\'email :', error))
        }
    })
}

