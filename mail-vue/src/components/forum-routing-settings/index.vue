<template>
  <div class="forum-routing">
    <el-button size="small" type="primary" @click="open">{{ t('configure') }}</el-button>
    <el-dialog v-model="visible" :title="t('forumRouting')" width="760px">
      <el-alert :title="t('forumSecurityInfo')" type="info" :closable="false"/>
      <h3>{{ t('forumGroup') }}</h3>
      <div class="grid">
        <el-input v-model="forum.chatId" :placeholder="t('forumChatId')"/>
        <el-input-number v-model="forum.defaultNormalThreadId" :min="1" :placeholder="t('defaultNormalTopic')"/>
        <el-input-number v-model="forum.defaultSpamThreadId" :min="1" :placeholder="t('defaultSpamTopic')"/>
        <el-switch v-model="forum.enabled" :active-value="1" :inactive-value="0" :active-text="t('forumEnabled')"/>
      </div>
      <div class="actions"><el-button type="primary" @click="saveForum">{{ t('saveForum') }}</el-button><el-button @click="testTopic">{{ t('sendTopicTest') }}</el-button></div>
      <h3>{{ t('recipientRoutes') }}</h3>
      <div class="grid"><el-input v-model="route.recipientEmail" placeholder="recipient@example.com"/><el-input-number v-model="route.normalThreadId" :min="1" :placeholder="t('normalTopic')"/><el-input-number v-model="route.spamThreadId" :min="1" :placeholder="t('spamTopic')"/><el-button @click="saveRoute">{{ t('addOrUpdate') }}</el-button></div>
      <el-table :data="routes" size="small"><el-table-column prop="recipient_email" :label="t('recipientEmail')"/><el-table-column prop="normal_thread_id" :label="t('normal')"/><el-table-column prop="spam_thread_id" :label="t('spam')"/><el-table-column width="90"><template #default="scope"><el-button link type="danger" @click="removeRoute(scope.row.route_id)">{{ t('delete') }}</el-button></template></el-table-column></el-table>
      <h3>{{ t('cloudflareZones') }}</h3>
      <div class="grid zone"><el-input v-model="zone.domain" placeholder="example.com"/><el-input v-model="zone.cloudflareZoneId" :placeholder="t('zoneId')"/><el-button @click="saveZone">{{ t('addOrUpdate') }}</el-button></div>
      <el-table :data="zones" size="small"><el-table-column prop="domain" :label="t('domain')"/><el-table-column prop="cloudflare_zone_id" :label="t('zoneId')"/><el-table-column width="90"><template #default="scope"><el-button link type="danger" @click="removeZone(scope.row.id)">{{ t('delete') }}</el-button></template></el-table-column></el-table>
      <h3>{{ t('globalSpamPolicy') }}</h3>
      <div class="grid policy"><el-switch v-model="policy.spamEnabled" :active-value="1" :inactive-value="0" :active-text="t('spamScoring')"/><el-switch v-model="policy.spamCfIsSpam" :active-value="1" :inactive-value="0" :active-text="t('cloudflareSpamAlways')"/><el-input-number v-model="policy.spamThreshold" :min="1" :placeholder="t('threshold')"/><el-input-number v-model="policy.spamSpfSoftfail" :min="0" :placeholder="t('spfSoftfail')"/><el-input-number v-model="policy.spamSpfNone" :min="0" :placeholder="t('spfNone')"/><el-input-number v-model="policy.spamSpfFail" :min="0" :placeholder="t('spfFail')"/><el-input-number v-model="policy.spamDkimNone" :min="0" :placeholder="t('dkimNone')"/><el-input-number v-model="policy.spamDkimFail" :min="0" :placeholder="t('dkimFail')"/><el-input-number v-model="policy.spamDmarcNone" :min="0" :placeholder="t('dmarcNone')"/><el-input-number v-model="policy.spamDmarcFail" :min="0" :placeholder="t('dmarcFail')"/></div>
      <div class="actions"><el-button type="primary" @click="savePolicy">{{ t('saveSpamPolicy') }}</el-button></div>
      <h3>{{ t('senderOverrides') }}</h3>
      <div class="grid"><el-select v-model="rule.matchType"><el-option value="email" :label="t('email')"/><el-option value="domain" :label="t('domain')"/></el-select><el-input v-model="rule.value" placeholder="sender@example.com or domain"/><el-select v-model="rule.action"><el-option value="spam" :label="t('forceSpam')"/><el-option value="normal" :label="t('forceNormal')"/></el-select><el-button @click="saveRule">{{ t('add') }}</el-button></div>
      <el-table :data="rules" size="small"><el-table-column prop="match_type" :label="t('type')"/><el-table-column prop="value" :label="t('value')"/><el-table-column prop="action" :label="t('action')"/><el-table-column width="90"><template #default="scope"><el-button link type="danger" @click="removeRule(scope.row.rule_id)">{{ t('delete') }}</el-button></template></el-table-column></el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { settingQuery, settingSet } from '@/request/setting.js';
import { deleteForumRoute, deleteForumZone, deleteSpamRule, forumConfig, forumRoutes, forumZones, saveForumConfig, saveForumRoute, saveForumZone, saveSpamRule, spamRules, testForumTopic } from '@/request/forum.js';
const visible = ref(false), routes = ref([]), zones = ref([]), rules = ref([]);
const { t } = useI18n();
const forum = reactive({ enabled: 0, chatId: '', defaultNormalThreadId: 0, defaultSpamThreadId: 0 });
const route = reactive({ recipientEmail: '', normalThreadId: 0, spamThreadId: 0 }); const zone = reactive({ domain: '', cloudflareZoneId: '' }); const rule = reactive({ matchType: 'email', value: '', action: 'spam' }); const policy = reactive({});
const copy = (target, source) => Object.assign(target, source || {});
async function reload() { let [config, routeRows, zoneRows, ruleRows, settings] = await Promise.all([forumConfig(), forumRoutes(), forumZones(), spamRules(), settingQuery()]); config = config || {}; copy(forum, { enabled: config.enabled || 0, chatId: config.chat_id || '', defaultNormalThreadId: config.default_normal_thread_id || 0, defaultSpamThreadId: config.default_spam_thread_id || 0 }); routes.value = routeRows || []; zones.value = zoneRows || []; rules.value = ruleRows || []; copy(policy, settings); }
async function open() { await reload(); visible.value = true; }
async function saveForum() { await saveForumConfig(forum); ElMessage.success(t('forumSaved')); await reload(); }
async function testTopic() { await testForumTopic({ chatId: forum.chatId, threadId: forum.defaultNormalThreadId }); ElMessage.success(t('topicTestSent')); }
async function saveRoute() { await saveForumRoute(route); route.recipientEmail = ''; route.normalThreadId = route.spamThreadId = 0; await reload(); }
async function removeRoute(id) { await deleteForumRoute(id); await reload(); }
async function saveZone() { await saveForumZone(zone); zone.domain = zone.cloudflareZoneId = ''; await reload(); }
async function removeZone(id) { await deleteForumZone(id); await reload(); }
async function savePolicy() { await settingSet({ spamEnabled: policy.spamEnabled, spamThreshold: policy.spamThreshold, spamCfIsSpam: policy.spamCfIsSpam, spamSpfSoftfail: policy.spamSpfSoftfail, spamSpfNone: policy.spamSpfNone, spamSpfFail: policy.spamSpfFail, spamDkimNone: policy.spamDkimNone, spamDkimFail: policy.spamDkimFail, spamDmarcNone: policy.spamDmarcNone, spamDmarcFail: policy.spamDmarcFail }); ElMessage.success(t('spamPolicySaved')); }
async function saveRule() { await saveSpamRule(rule); rule.value = ''; await reload(); }
async function removeRule(id) { await deleteSpamRule(id); await reload(); }
</script>

<style scoped>.forum-routing{display:inline-block}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:8px}.policy{grid-template-columns:repeat(3,minmax(0,1fr))}.actions{display:flex;gap:8px;margin:10px 0 18px}h3{margin:22px 0 10px}.el-table{margin-bottom:14px}@media(max-width:760px){.grid,.policy{grid-template-columns:1fr}}</style>
