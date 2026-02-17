import bcrypt from 'bcrypt'

export class Auth {
    static async hashPassword(password, saltRounds = 10) {
        try {
            if (typeof password !== 'string' || password.length === 0) {
                throw new Error('Le mot de passe doit être une chaîne non vide')
            }

            return await bcrypt.hash(password, saltRounds)
            
        } catch (error) {
            throw new Error('Le hashing a échoué: ' + error.message)
        }
    }


    static async comparePassword(password, hash) {
        return await bcrypt.compare(password, hash)
    }
}