const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');
const randomUseragent = require('random-useragent');

class Goats {
    constructor() {
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en-US,en;q=0.5",
            "Content-Type": "application/json",
            "Origin": "https://dev.goatsbot.xyz",
            "Referer": "https://dev.goatsbot.xyz/",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": randomUseragent.getRandom()
        };
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [*] ${msg}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${msg}`.magenta);
                break;        
            case 'error':
                console.log(`[${timestamp}] [!] ${msg}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] [*] ${msg}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] [*] ${msg}`.blue);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i >= 0; i--) {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`===== Waiting ${i} seconds to continue =====`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        process.stdout.write(`\n`);
    }

    async login(rawData) {
        const url = "https://dev-api.goatsbot.xyz/auth/login";
        const userData = JSON.parse(decodeURIComponent(rawData.split('user=')[1].split('&')[0]));

        try {
            const response = await axios.post(url, {}, {
                headers: {
                    ...this.headers,
                    'Rawdata': rawData
                }
            });

            if (response.status === 201) {
                const { age, balance } = response.data.user;
                const accessToken = response.data.tokens.access.token;
                return { success: true, data: { age, balance, accessToken }, userData };
            }
            return { success: false, error: 'Login failed' };
        } catch (error) {
            return { success: false, error: `Error during login: ${error.message}` };
        }
    }

    async getMissions(accessToken) {
        const url = "https://api-mission.goatsbot.xyz/missions/user";
        try {
            const response = await axios.get(url, {
                headers: {
                    ...this.headers,
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (response.status === 200) {
                const missions = { special: [], regular: [] };
                Object.entries(response.data).forEach(([category, missionList]) => {
                    missionList.forEach(mission => {
                        if (category === 'SPECIAL MISSION') {
                            missions.special.push(mission);
                        } else if (!mission.status) {
                            missions.regular.push(mission);
                        }
                    });
                });
                return { success: true, missions };
            }
            return { success: false, error: 'Failed to get missions' };
        } catch (error) {
            return { success: false, error: `Error fetching missions: ${error.message}` };
        }
    }

    async completeMission(mission, accessToken) {
        if (mission.type === 'Special') {
            const now = DateTime.now().toUnixInteger();
            if (mission.next_time_execute && now < mission.next_time_execute) {
                const timeLeft = mission.next_time_execute - now;
                this.log(`Mission ${mission.name} is in cooldown: ${timeLeft} seconds`, 'warning');
                return false;
            }
        }

        const url = `https://dev-api.goatsbot.xyz/missions/action/${mission._id}`;
        try {
            const response = await axios.post(url, {}, {
                headers: {
                    ...this.headers,
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            return response.status === 201;
        } catch (error) {
            return false;
        }
    }

    async handleMissions(accessToken) {
        const missionsResult = await this.getMissions(accessToken);
        if (!missionsResult.success) {
            this.log(`Unable to fetch missions: ${missionsResult.error}`, 'error');
            return;
        }

        const { special, regular } = missionsResult.missions;

        for (const mission of special) {
            this.log(`Processing special mission: ${mission.name}`, 'info');
            const result = await this.completeMission(mission, accessToken);

            if (result) {
                this.log(`Successfully completed mission ${mission.name} | Reward: ${mission.reward}`, 'success');
            } else {
                this.log(`Failed to complete mission ${mission.name}`, 'error');
            }
        }

        for (const mission of regular) {
            const result = await this.completeMission(mission, accessToken);
            if (result) {
                this.log(`Successfully completed mission ${mission.name} | Reward: ${mission.reward}`, 'success');
            } else {
                this.log(`Failed to complete mission ${mission.name}`, 'error');
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        await this.countdown(1);
    }

    async getCheckinInfo(accessToken) {
        const url = "https://api-checkin.goatsbot.xyz/checkin/user";
        try {
            const response = await axios.get(url, {
                headers: {
                    ...this.headers,
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (response.status === 200) {
                return { success: true, data: response.data };
            }
            return { success: false, error: 'Failed to get check-in info' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async performCheckin(checkinId, accessToken) {
        const url = `https://api-checkin.goatsbot.xyz/checkin/action/${checkinId}`;
        try {
            const response = await axios.post(url, {}, {
                headers: {
                    ...this.headers,
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            return response.status === 201;
        } catch (error) {
            return false;
        }
    }

    async handleCheckin(accessToken) {
        try {
            const checkinInfo = await this.getCheckinInfo(accessToken);
            if (!checkinInfo.success) {
                this.log(`Unable to fetch check-in info: ${checkinInfo.error}`, 'error');
                return;
            }

            const { result, lastCheckinTime } = checkinInfo.data;
            const currentTime = Date.now();
            const timeSinceLastCheckin = currentTime - lastCheckinTime;
            const twentyFourHours = 24 * 60 * 60 * 1000;

            if (timeSinceLastCheckin < twentyFourHours) {
                this.log(`Not enough time since last check-in`, 'warning');
                return;
            }

            const nextCheckin = result.find(day => !day.status);
            if (!nextCheckin) {
                this.log(`All check-in days completed`, 'custom');
                return;
            }

            const checkinResult = await this.performCheckin(nextCheckin._id, accessToken);
            if (checkinResult) {
                this.log(`Successfully checked in on day ${nextCheckin.day} | Reward: ${nextCheckin.reward}`, 'success');
            } else {
                this.log(`Failed to check in on day ${nextCheckin.day}`, 'error');
            }
        } catch (error) {
            this.log(`Error handling check-in: ${error.message}`, 'error');
        }
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        const userTokens = {};

        for (let i = 0; i < data.length; i++) {
            const initData = data[i];
            const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
            const firstName = userData.first_name;

            console.log(`========== Account ${i + 1} | ${firstName} ==========`.blue);
            if (!userTokens[userData.id]) {
                const loginResult = await this.login(initData);
                if (!loginResult.success) {
                    this.log(`Login failed for ${firstName}: ${loginResult.error}`, 'error');
                    continue;
                }
                this.log(`Login successful for ${firstName}!`, 'success');
                userTokens[userData.id] = loginResult.data.accessToken;
            }

            const accessToken = userTokens[userData.id];
            await this.handleCheckin(accessToken);
            await this.handleMissions(accessToken);
        }

        console.log(`Waiting for next round...`.yellow);
        await this.countdown(60);
        this.main();
    }
}

const goats = new Goats();
goats.main();
