/**
 * Test Report Generator
 * Generates HTML reports with test results, screenshots, and bug analysis
 */

const fs = require('fs');
const path = require('path');

class Reporter {
    constructor(outputDir) {
        this.outputDir = outputDir;
        this.screenshotsDir = path.join(outputDir, 'screenshots');

        // Ensure directories exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        if (!fs.existsSync(this.screenshotsDir)) {
            fs.mkdirSync(this.screenshotsDir, { recursive: true });
        }
    }

    /**
     * Generate the HTML report
     */
    generateReport(results) {
        const {
            startTime,
            endTime,
            floors,
            bugs,
            deaths,
            screenshots,
            actions,
            stats
        } = results;

        const duration = endTime - startTime;
        const durationStr = this.formatDuration(duration);

        // Save screenshots as files
        const savedScreenshots = screenshots.map((ss, i) => {
            const filename = `screenshot_${i}_floor${ss.floor}_${ss.time}ms.png`;
            const filepath = path.join(this.screenshotsDir, filename);
            fs.writeFileSync(filepath, Buffer.from(ss.image, 'base64'));
            return {
                ...ss,
                filename
            };
        });

        const html = this.buildHTML({
            duration: durationStr,
            durationMs: duration,
            floorsReached: floors.length > 0 ? Math.max(...floors.map(f => f.floor)) : 1,
            floors,
            bugs,
            deaths,
            screenshots: savedScreenshots,
            actions: actions || 0,
            stats: stats || {},
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString()
        });

        const reportPath = path.join(this.outputDir, 'report.html');
        fs.writeFileSync(reportPath, html);

        // Also save JSON data
        const jsonPath = path.join(this.outputDir, 'results.json');
        fs.writeFileSync(jsonPath, JSON.stringify({
            ...results,
            screenshots: savedScreenshots.map(s => ({
                ...s,
                image: undefined // Don't include base64 in JSON
            }))
        }, null, 2));

        return reportPath;
    }

    /**
     * Build the HTML content
     */
    buildHTML(data) {
        const {
            duration,
            durationMs,
            floorsReached,
            floors,
            bugs,
            deaths,
            screenshots,
            actions,
            stats,
            startTime,
            endTime
        } = data;

        const bugSeverityColor = (severity) => {
            switch (severity) {
                case 'critical': return '#ff0000';
                case 'high': return '#ff6600';
                case 'medium': return '#ffaa00';
                case 'low': return '#88aa00';
                default: return '#888888';
            }
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dungeon Tower Test Report</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #1a1a2e;
            color: #eee;
            line-height: 1.6;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        header {
            text-align: center;
            padding: 40px 0;
            border-bottom: 2px solid #333;
        }
        h1 {
            color: #ffd700;
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .subtitle {
            color: #888;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .stat-card {
            background: #252542;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }
        .stat-card h3 {
            color: #888;
            font-size: 0.9em;
            text-transform: uppercase;
        }
        .stat-card .value {
            font-size: 2.5em;
            font-weight: bold;
            color: #ffd700;
        }
        .stat-card .value.good { color: #44ff44; }
        .stat-card .value.bad { color: #ff4444; }
        .stat-card .value.neutral { color: #4488ff; }
        section {
            margin: 40px 0;
        }
        section h2 {
            color: #ffd700;
            border-bottom: 1px solid #444;
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .bug-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .bug-item {
            background: #252542;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid;
        }
        .bug-item .bug-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        .bug-item .bug-type {
            font-weight: bold;
        }
        .bug-item .bug-time {
            color: #888;
        }
        .bug-item .bug-details {
            color: #aaa;
            font-size: 0.9em;
        }
        .floor-timeline {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .floor-item {
            background: #252542;
            padding: 15px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 20px;
        }
        .floor-number {
            font-size: 2em;
            color: #ffd700;
            min-width: 60px;
            text-align: center;
        }
        .floor-stats {
            flex: 1;
            display: flex;
            gap: 30px;
        }
        .floor-stat {
            text-align: center;
        }
        .floor-stat .label {
            color: #888;
            font-size: 0.8em;
        }
        .floor-stat .value {
            font-size: 1.2em;
            font-weight: bold;
        }
        .screenshots {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
        }
        .screenshot-item {
            background: #252542;
            border-radius: 8px;
            overflow: hidden;
        }
        .screenshot-item img {
            width: 100%;
            height: 200px;
            object-fit: cover;
        }
        .screenshot-info {
            padding: 10px;
        }
        .screenshot-info .time {
            color: #ffd700;
        }
        .screenshot-info .floor {
            color: #888;
        }
        .no-bugs {
            text-align: center;
            padding: 40px;
            color: #44ff44;
            background: #1a3a1a;
            border-radius: 10px;
        }
        .balance-section {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
        }
        .balance-card {
            background: #252542;
            padding: 20px;
            border-radius: 10px;
        }
        .balance-card h4 {
            color: #ffd700;
            margin-bottom: 15px;
        }
        .balance-meter {
            height: 20px;
            background: #333;
            border-radius: 10px;
            overflow: hidden;
            margin: 10px 0;
        }
        .balance-fill {
            height: 100%;
            border-radius: 10px;
            transition: width 0.3s;
        }
        .balance-fill.good { background: linear-gradient(to right, #228822, #44ff44); }
        .balance-fill.warning { background: linear-gradient(to right, #886600, #ffaa00); }
        .balance-fill.danger { background: linear-gradient(to right, #662222, #ff4444); }
        footer {
            text-align: center;
            padding: 40px;
            color: #666;
            border-top: 1px solid #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Dungeon Tower Test Report</h1>
            <p class="subtitle">Automated Playtest Results</p>
            <p class="subtitle">${startTime} - ${endTime}</p>
        </header>

        <div class="summary">
            <div class="stat-card">
                <h3>Test Duration</h3>
                <div class="value neutral">${duration}</div>
            </div>
            <div class="stat-card">
                <h3>Floors Reached</h3>
                <div class="value good">${floorsReached}</div>
            </div>
            <div class="stat-card">
                <h3>Deaths</h3>
                <div class="value ${deaths > 0 ? 'bad' : 'good'}">${deaths}</div>
            </div>
            <div class="stat-card">
                <h3>Bugs Detected</h3>
                <div class="value ${bugs.length > 0 ? 'bad' : 'good'}">${bugs.length}</div>
            </div>
            <div class="stat-card">
                <h3>Total Actions</h3>
                <div class="value neutral">${actions}</div>
            </div>
        </div>

        <section>
            <h2>Bug Report</h2>
            ${bugs.length === 0 ? `
                <div class="no-bugs">
                    <h3>No Bugs Detected</h3>
                    <p>The automated test completed without detecting any anomalies.</p>
                </div>
            ` : `
                <div class="bug-list">
                    ${bugs.map(bug => `
                        <div class="bug-item" style="border-color: ${bugSeverityColor(bug.severity)}">
                            <div class="bug-header">
                                <span class="bug-type" style="color: ${bugSeverityColor(bug.severity)}">${bug.type}</span>
                                <span class="bug-time">${this.formatDuration(bug.time)} - Floor ${bug.floor}</span>
                            </div>
                            <div class="bug-details">${bug.description}</div>
                        </div>
                    `).join('')}
                </div>
            `}
        </section>

        <section>
            <h2>Floor Progression</h2>
            <div class="floor-timeline">
                ${floors.map(floor => `
                    <div class="floor-item">
                        <div class="floor-number">F${floor.floor}</div>
                        <div class="floor-stats">
                            <div class="floor-stat">
                                <div class="label">Clear Time</div>
                                <div class="value">${this.formatDuration(floor.clearTime)}</div>
                            </div>
                            <div class="floor-stat">
                                <div class="label">Enemies Killed</div>
                                <div class="value">${floor.enemiesKilled || 0}</div>
                            </div>
                            <div class="floor-stat">
                                <div class="label">Items Used</div>
                                <div class="value">${floor.itemsUsed || 0}</div>
                            </div>
                            <div class="floor-stat">
                                <div class="label">HP Remaining</div>
                                <div class="value" style="color: ${floor.hpRemaining > 50 ? '#44ff44' : floor.hpRemaining > 20 ? '#ffaa00' : '#ff4444'}">${floor.hpRemaining}%</div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </section>

        <section>
            <h2>Game Balance Analysis</h2>
            <div class="balance-section">
                <div class="balance-card">
                    <h4>Difficulty</h4>
                    <p>Based on deaths and HP loss</p>
                    <div class="balance-meter">
                        <div class="balance-fill ${stats.difficultyScore > 70 ? 'danger' : stats.difficultyScore > 40 ? 'warning' : 'good'}" style="width: ${stats.difficultyScore || 50}%"></div>
                    </div>
                    <p>${stats.difficultyScore > 70 ? 'Very Hard' : stats.difficultyScore > 40 ? 'Balanced' : 'Easy'}</p>
                </div>
                <div class="balance-card">
                    <h4>Item Availability</h4>
                    <p>Potions and power-ups found</p>
                    <div class="balance-meter">
                        <div class="balance-fill ${stats.itemScore > 60 ? 'good' : stats.itemScore > 30 ? 'warning' : 'danger'}" style="width: ${stats.itemScore || 50}%"></div>
                    </div>
                    <p>${stats.itemScore > 60 ? 'Abundant' : stats.itemScore > 30 ? 'Adequate' : 'Scarce'}</p>
                </div>
                <div class="balance-card">
                    <h4>Pacing</h4>
                    <p>Floor clear time analysis</p>
                    <div class="balance-meter">
                        <div class="balance-fill ${stats.pacingScore > 70 ? 'good' : stats.pacingScore > 40 ? 'warning' : 'danger'}" style="width: ${stats.pacingScore || 50}%"></div>
                    </div>
                    <p>${stats.pacingScore > 70 ? 'Well Paced' : stats.pacingScore > 40 ? 'Moderate' : 'Slow'}</p>
                </div>
            </div>
        </section>

        <section>
            <h2>Screenshots Timeline</h2>
            <div class="screenshots">
                ${screenshots.map(ss => `
                    <div class="screenshot-item">
                        <img src="screenshots/${ss.filename}" alt="Screenshot at ${this.formatDuration(ss.time)}">
                        <div class="screenshot-info">
                            <span class="time">${this.formatDuration(ss.time)}</span>
                            <span class="floor">Floor ${ss.floor}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </section>

        <footer>
            <p>Generated by Dungeon Tower Auto-Test System</p>
            <p>Test completed in ${duration}</p>
        </footer>
    </div>
</body>
</html>`;
    }

    /**
     * Format duration from milliseconds to readable string
     */
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;

        if (minutes === 0) {
            return `${remainingSeconds}s`;
        }
        return `${minutes}m ${remainingSeconds}s`;
    }

    /**
     * Log progress to console
     */
    logProgress(message, data = {}) {
        const timestamp = new Date().toISOString().substr(11, 8);
        console.log(`[${timestamp}] ${message}`, data);
    }
}

module.exports = Reporter;
