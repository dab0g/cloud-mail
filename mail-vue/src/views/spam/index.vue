<template>
  <emailScroll ref="scroll" :get-email-list="getEmailList" :email-delete="emailDelete" :star-add="starAdd" :star-cancel="starCancel" :time-sort="params.timeSort" :email-read="emailRead" :show-unread="true" actionLeft="4px" @jump="jumpContent">
    <template #first><Icon class="icon" icon="material-symbols-light:timer-arrow-down-outline" width="28" @click="params.timeSort = params.timeSort ? 0 : 1; scroll.refreshList()"/></template>
  </emailScroll>
</template>
<script setup>
import { reactive, ref } from 'vue';
import { Icon } from '@iconify/vue';
import router from '@/router/index.js';
import emailScroll from '@/components/email-scroll/index.vue';
import { useAccountStore } from '@/store/account.js';
import { useEmailStore } from '@/store/email.js';
import { emailDelete, emailList, emailRead } from '@/request/email.js';
import { starAdd, starCancel } from '@/request/star.js';
const scroll = ref({}); const params = reactive({ timeSort: 0 }); const accountStore = useAccountStore(); const emailStore = useEmailStore();
function getEmailList(emailId, size) { return emailList(accountStore.currentAccountId, accountStore.currentAccount.allReceive, emailId, params.timeSort, size, 0, 1); }
function jumpContent(email) { emailStore.contentData.email = email; emailStore.contentData.delType = 'logic'; emailStore.contentData.showUnread = true; emailStore.contentData.showStar = true; emailStore.contentData.showReply = true; router.push('/message'); }
</script>
